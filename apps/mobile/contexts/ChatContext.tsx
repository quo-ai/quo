import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode, useRef, Dispatch, SetStateAction } from 'react';
import { InteractionManager } from 'react-native';
import { Conversation, AppSettings, Message, ImageAttachment, DocumentAttachment, GenerationStats } from '@/types/chat';
import { loadConversations, loadSettings, saveSettings, defaultSettings, capConversationsForFreeTier, deleteConversationRows, clearConversationRows } from '@/services/storage';
import { createConversation, createMessage, generateTitle } from '@/services/chat';
import { llmService, ModelStatus } from '@/services/llm';
import { notificationService } from '@/services/notifications';
import { customModelService } from '@/services/customModelService';
import { recallService } from '@/services/recallService';
import { FREE_TIER_LIMITS, PREMIUM_FEATURES } from '@/constants/premium';
import { usePremium } from '@/contexts/PremiumContext';
import { analyticsService } from '@/services/analyticsService';
import {
  applyModelToSettings,
  getFreeStarterModel,
  isFreeTierModel,
  getTaskType,
  getCurrentModelAnalyticsParams,
  stripImageBase64,
} from '@/contexts/chat/helpers';
import { runToolLoop } from '@/contexts/chat/toolLoop';
import { buildUserMessages } from '@/contexts/chat/messageBuilder';
import { useStreamingContent, StreamingState } from '@/contexts/chat/useStreamingContent';
import { useConversationPersistence } from '@/contexts/chat/useConversationPersistence';
import { createChatBridge } from '@/contexts/chat/syncBridge';
import { registerChatBridge } from '@/services/sync/bridge';
import { initSync } from '@/services/sync';
import { useAppLifecycle } from '@/contexts/chat/useAppLifecycle';
import { useModelLifecycle } from '@/contexts/chat/useModelLifecycle';
import { useContextCompression } from '@/contexts/chat/useContextCompression';

interface ChatContextType {
  conversations: Conversation[];
  currentConversation: Conversation | null;
  settings: AppSettings;
  isLoading: boolean;
  isGenerating: boolean;
  modelLoaded: boolean;
  modelLoadProgress: number;
  modelStatus: ModelStatus;
  modelError: string | null;
  showDownloadModal: boolean;
  showModelSelection: boolean;
  downloadingModelId: string | null;
  visionEnabled: boolean;
  setCurrentConversation: (conversation: Conversation | null) => void;
  createNewChat: () => Conversation | null;
  deleteConversation: (id: string) => void;
  sendMessage: (content: string, targetConversation?: Conversation, image?: ImageAttachment, document?: DocumentAttachment) => Promise<boolean>;
  resendMessage: (messageId: string, newContent?: string) => Promise<void>;
  /** Regenerate an assistant reply from the user message that prompted it. */
  regenerateMessage: (assistantMessageId: string) => Promise<void>;
  stopGeneration: () => Promise<void>;
  updateSettings: (settings: Partial<AppSettings>) => void;
  loadModel: () => Promise<boolean>;
  startDownload: () => Promise<void>;
  startDownloadForModel: (modelId: string) => Promise<void>;
  /** Load a downloaded model; settings.modelId changes only once it loaded. */
  selectModel: (modelId: string) => Promise<boolean>;
  /** Call after a model's files were deleted (switches off it if active). */
  handleModelDeleted: (modelId: string) => Promise<void>;
  cancelDownload: () => void;
  dismissDownloadModal: () => void;
  showDownloadPrompt: () => void;
  clearAllChats: () => void;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);
// Streaming text lives in its own context: it changes every ~150ms during a
// reply, and only the streaming UI should re-render for it.
const StreamingContext = createContext<StreamingState>({ content: '', conversationId: null });

export function ChatProvider({ children }: { children: ReactNode }) {
  const { isPremium, isLoading: isPremiumLoading, openUpgradeModal, markActivated } = usePremium();

  const [conversations, setConversationsState] = useState<Conversation[]>([]);
  const [currentConversation, setCurrentConversation] = useState<Conversation | null>(null);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const {
    streaming,
    startStreaming,
    updateStreamingContent,
    clearPendingThrottle,
    getLatestContent,
    resetStreaming,
  } = useStreamingContent();

  // Generation state refs for synchronous access (avoid stale closures)
  const isGeneratingRef = useRef(false);
  const activeGenerationIdRef = useRef<string | null>(null); // Unique ID per generation
  const activeConversationIdRef = useRef<string | null>(null);

  // Latest state for callbacks, so they can stay referentially stable instead
  // of being recreated (and re-rendering consumers) on every state change.
  const conversationsRef = useRef(conversations);
  const currentConversationRef = useRef(currentConversation);
  useEffect(() => {
    currentConversationRef.current = currentConversation;
  }, [currentConversation]);

  // The chats are kept in the ref and React state mirrors it, so the ref is
  // always the latest word (an update applies to it at once, not at the next
  // render). Quo Sync reads and writes chats through it, and has to see an edit
  // the moment it's made. Callers use this exactly like a state setter.
  const setConversations = useCallback<Dispatch<SetStateAction<Conversation[]>>>(action => {
    const next = typeof action === 'function' ? action(conversationsRef.current) : action;
    conversationsRef.current = next;
    setConversationsState(next);
  }, []);

  const {
    modelLoaded,
    modelLoadProgress,
    modelStatus,
    modelError,
    showDownloadModal,
    visionEnabled,
    showModelSelection,
    downloadingModelId,
    downloadStateRef,
    setModelLoaded,
    setModelStatus,
    setModelError,
    bootstrapModel,
    loadModel,
    startDownload,
    startDownloadForModel,
    selectModel,
    handleModelDeleted,
    cancelDownload,
    dismissDownloadModal,
    showDownloadPrompt,
  } = useModelLifecycle({ isPremium, setSettings });

  const { isInBackgroundRef } = useAppLifecycle({ isGeneratingRef, downloadStateRef });

  // Init must see the real premium status: run it exactly once, after
  // PremiumContext has loaded. Running as "free" first would swap a premium
  // user's model for the starter and cap (then delete) their conversations.
  const initStartedRef = useRef(false);
  useEffect(() => {
    if (isPremiumLoading || initStartedRef.current) return;
    initStartedRef.current = true;
    const initStartedAt = Date.now();

    async function init() {
      const [loadedConversations, loadedSettings] = await Promise.all([
        loadConversations(),
        loadSettings(),
      ]);

      let effectiveSettings = loadedSettings;
      if (!isPremium && !isFreeTierModel(loadedSettings.modelId)) {
        effectiveSettings = applyModelToSettings(loadedSettings, getFreeStarterModel());
        await saveSettings(effectiveSettings);
      }

      const cappedConversations = isPremium ? loadedConversations : capConversationsForFreeTier(loadedConversations, FREE_TIER_LIMITS.MAX_CHAT_HISTORY);
      if (cappedConversations.length !== loadedConversations.length) {
        const kept = new Set(cappedConversations.map(c => c.id));
        void deleteConversationRows(loadedConversations.filter(c => !kept.has(c.id)).map(c => c.id), { quiet: true });
      }
      setConversations(cappedConversations);
      setSettings(effectiveSettings);
      setIsLoading(false);
      void analyticsService.trackProvidersReady(Date.now() - initStartedAt, cappedConversations.length > 0);
      if (cappedConversations.some(conversation => conversation.messages.some(message => message.role === 'assistant'))) {
        markActivated();
      }
      void analyticsService.setUserProperties({
        premium_status: isPremium ? 'premium' : 'free',
        selected_model_id: effectiveSettings.modelId,
        starter_model_id: FREE_TIER_LIMITS.STARTER_MODEL_ID,
        chat_count: cappedConversations.length,
      });

      // Open the most recent conversation if one exists
      if (cappedConversations.length > 0) {
        // Sort by updatedAt descending and pick the most recent
        const sortedConversations = [...cappedConversations].sort((a, b) => b.updatedAt - a.updatedAt);
        setCurrentConversation(sortedConversations[0]);
      }

      llmService.setSpeculativeEnabled(Boolean(effectiveSettings.enableSpeculative));

      // Sync LLM service with saved model selection (use async for custom models)
      if (effectiveSettings.modelId) {
        if (customModelService.isCustomModel(effectiveSettings.modelId)) {
          await llmService.setCurrentModelAsync(effectiveSettings.modelId);
        } else {
          llmService.setCurrentModel(effectiveSettings.modelId);
        }
      }

      // Defer heavy model loading until after pending interactions/animations
      // complete. This prevents ANR ("Input dispatching timed out") on startup
      // because initLlama's native memory-mapping competes with the UI thread.
      InteractionManager.runAfterInteractions(async () => {
        // Small additional yield so the JS thread can flush any queued UI work
        await new Promise(resolve => setTimeout(resolve, 100));
        await bootstrapModel(effectiveSettings);
      });
    }

    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPremiumLoading]);

  const { flush: flushConversations } = useConversationPersistence({
    conversations,
    getLatest: () => conversationsRef.current,
    setConversations,
    currentConversation,
    setCurrentConversation,
    isLoading,
    isPremium,
  });

  // Quo Sync reads and writes the chats through this, and starts once they've loaded.
  const isLoadingRef = useRef(true);
  useEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);
  useEffect(() => registerChatBridge(createChatBridge({
    conversations: conversationsRef,
    setConversations,
    setCurrentConversation,
    flush: flushConversations,
    busy: () => isGeneratingRef.current || isLoadingRef.current,
    onRemoved: id => void recallService.deleteIndex(id),
  })), [setConversations, flushConversations]);
  useEffect(() => {
    if (!isLoading) void initSync();
  }, [isLoading]);

  useContextCompression({
    currentConversation,
    setCurrentConversation,
    setConversations,
    isLoading,
    isGenerating,
    isGeneratingRef,
    modelLoaded,
    isPremium,
  });

  const switchConversation = useCallback((conversation: Conversation | null) => {
    if (conversation?.id !== currentConversationRef.current?.id) {
      // No-op while a reply is generating; it keeps running in its own chat.
      void llmService.clearCache();
      if (conversation && conversation.messages.length > 0) {
        void analyticsService.trackChatReopened(conversation.messages.length);
      }
    }
    setCurrentConversation(conversation);
  }, []);

  const createNewChat = useCallback(() => {
    if (!isPremium && conversationsRef.current.length >= FREE_TIER_LIMITS.MAX_CHAT_HISTORY) {
      openUpgradeModal(PREMIUM_FEATURES.UNLIMITED_HISTORY);
      return null;
    }

    const newConversation = createConversation();
    setConversations(prev => [newConversation, ...prev]);
    switchConversation(newConversation);
    void analyticsService.trackChatCreated('manual_or_first_message');
    return newConversation;
  }, [isPremium, openUpgradeModal, switchConversation]);

  // Append an assistant message to a conversation (and the open copy of it).
  const appendAssistantMessage = useCallback((conversationId: string, assistantMessage: Message) => {
    const append = (c: Conversation): Conversation => ({
      ...c,
      messages: [...c.messages, assistantMessage],
      updatedAt: Date.now(),
    });
    setConversations(prev => prev.map(c => (c.id === conversationId ? append(c) : c)));
    setCurrentConversation(prev => (prev && prev.id === conversationId ? append(prev) : prev));
  }, []);

  // The in-flight stop (if any). New generations wait for it so they never
  // start while the previous native completion is still winding down.
  const stopPromiseRef = useRef<Promise<void> | null>(null);
  // Partial reply saved by the latest stop, for callers that need it in the
  // LLM history before React has re-rendered with it.
  const lastStoppedPartialRef = useRef<{ conversationId: string; message: Message } | null>(null);

  const stopGeneration = useCallback(async () => {
    if (!isGeneratingRef.current) {
      await stopPromiseRef.current;
      return;
    }

    // Dismiss ongoing notification if it was showing
    notificationService.dismissOngoingGenerationNotification().catch(() => {});

    // Mark as stopped immediately to prevent race conditions
    isGeneratingRef.current = false;
    const stoppedConvId = activeConversationIdRef.current;
    activeGenerationIdRef.current = null;
    activeConversationIdRef.current = null;

    // Clear any pending throttled updates
    clearPendingThrottle();

    // Capture the partial response before stopping (the ref includes tokens
    // not yet flushed to the throttled state)
    const partialResponse = getLatestContent();

    const stop = (async () => {
      // Abort the native completion and wait for it to wind down
      await llmService.stopGeneration();

      setIsGenerating(false);
      lastStoppedPartialRef.current = null;
      // If we have partial content, save it as a message
      if (partialResponse.trim() && stoppedConvId) {
        const message = createMessage('assistant', partialResponse);
        lastStoppedPartialRef.current = { conversationId: stoppedConvId, message };
        appendAssistantMessage(stoppedConvId, message);
      }
      resetStreaming();
    })();
    stopPromiseRef.current = stop;
    try {
      await stop;
    } finally {
      if (stopPromiseRef.current === stop) stopPromiseRef.current = null;
    }
  }, [clearPendingThrottle, getLatestContent, resetStreaming, appendAssistantMessage]);

  const deleteConversation = useCallback((id: string) => {
    if (activeConversationIdRef.current === id) {
      void stopGeneration();
    }
    setConversations(prev => prev.filter(c => c.id !== id));
    setCurrentConversation(prev => (prev?.id === id ? null : prev));
    void deleteConversationRows([id]);
    void recallService.deleteIndex(id);
  }, [stopGeneration]);

  // Sets up shared generation state and returns the unique ID used to detect
  // when this generation gets superseded by a newer one.
  const beginGeneration = useCallback((conversationId: string): string => {
    const generationId = `gen_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    setIsGenerating(true);
    isGeneratingRef.current = true;
    activeGenerationIdRef.current = generationId;
    activeConversationIdRef.current = conversationId;
    startStreaming(conversationId);
    return generationId;
  }, [startStreaming]);

  const markModelUnloaded = useCallback(() => {
    setModelLoaded(false);
    setModelStatus('error');
    setModelError('Model was unloaded. Please reload the model.');
  }, [setModelLoaded, setModelStatus, setModelError]);

  // Shared generation pipeline for sendMessage and resendMessage: runs the
  // tool loop, commits the assistant message, and handles notifications,
  // analytics, error recovery, and state cleanup.
  const runGenerationLoop = useCallback(async ({
    generationId,
    conversationId,
    llmMessages,
    buildFinalMessages,
    taskAnalyticsParams,
    generationStartedAt,
    isResend,
    contextSummary,
    recallContext,
  }: {
    generationId: string;
    conversationId: string;
    llmMessages: Message[];
    buildFinalMessages: (existingMessages: Message[], assistantMessage: Message) => Message[];
    taskAnalyticsParams: Parameters<typeof analyticsService.trackTaskStarted>[0];
    generationStartedAt: number;
    isResend: boolean;
    contextSummary?: string | null;
    recallContext?: string | null;
  }): Promise<boolean> => {
    try {
      const loopResult = await runToolLoop({
        llmMessages,
        settings,
        contextSummary,
        recallContext,
        isPremium,
        // Model-initiated, not a user tap: respect the pre-activation paywall hold.
        onMemoryLimit: () => openUpgradeModal(PREMIUM_FEATURES.UNLIMITED_MEMORY, { trigger: 'automatic' }),
        isCancelled: () => activeGenerationIdRef.current !== generationId,
        onStreamUpdate: updateStreamingContent,
      });

      if (loopResult.cancelled) {
        return false; // Exit without updating state - a new generation took over
      }

      if (loopResult.modelUnloaded) {
        // The native context died mid-reply: keep what streamed, then surface
        // the error state so the user reloads instead of sending into a void.
        if (activeGenerationIdRef.current === generationId && loopResult.finalResponse.trim()) {
          appendAssistantMessage(conversationId, createMessage('assistant', loopResult.finalResponse));
        }
        markModelUnloaded();
        return false;
      }

      const { finalResponse, toolActions: allToolActions, continuationRounds: totalContinuationRounds } = loopResult;
      const finalStats: GenerationStats | undefined = loopResult.stats;

      // Check if this generation was cancelled/superseded before committing
      if (activeGenerationIdRef.current !== generationId) {
        return false;
      }

      const assistantMessage = createMessage(
        'assistant',
        finalResponse || 'Done!',
        undefined,
        allToolActions.length > 0 ? allToolActions : undefined,
        finalStats
      );

      setConversations(prev => prev.map(c => {
        if (c.id === conversationId) {
          return {
            ...c,
            messages: buildFinalMessages(c.messages, assistantMessage),
            updatedAt: Date.now(),
          };
        }
        return c;
      }));

      setCurrentConversation(prev => {
        if (!prev || prev.id !== conversationId) return prev;
        return {
          ...prev,
          messages: buildFinalMessages(prev.messages, assistantMessage),
          updatedAt: Date.now(),
        };
      });

      // Send notification if app is in background
      if (isInBackgroundRef.current) {
        notificationService.sendGenerationCompleteNotification(finalResponse);
      }

      const completionParams = {
        ...taskAnalyticsParams,
        duration_ms: Date.now() - generationStartedAt,
        tool_count: allToolActions.length,
        prompt_tokens: finalStats?.promptTokens,
        completion_tokens: finalStats?.completionTokens,
        tokens_per_second: finalStats?.tokensPerSecond,
        continuation_rounds: totalContinuationRounds,
      };
      void analyticsService.trackTaskCompleted(completionParams);
      if (!isResend) {
        void analyticsService.trackFirstAnswerCompleted(completionParams);
        void analyticsService.setUserProperty('activated_status', 'activated');
        markActivated();
      }
      return true;

    } catch (error: any) {
      console.error(isResend ? 'Failed to regenerate response:' : 'Failed to generate response:', error);
      const errorMessage = error?.message || String(error);
      void analyticsService.trackInferenceFailed({
        ...taskAnalyticsParams,
        duration_ms: Date.now() - generationStartedAt,
        error: errorMessage,
      });
      analyticsService.recordError(error, isResend ? 'chat_regeneration_exception' : 'chat_generation_exception');

      // Dismiss ongoing notification on error while backgrounded
      notificationService.dismissOngoingGenerationNotification().catch(() => {});

      // Keep any text that streamed before the failure.
      const partial = getLatestContent();
      if (activeGenerationIdRef.current === generationId && partial.trim()) {
        appendAssistantMessage(conversationId, createMessage('assistant', partial));
      }

      // Check if the model context was invalidated
      if (errorMessage.includes('Terminated') || errorMessage.includes('ThreadPoolExecutor') || errorMessage.includes('unloaded')) {
        markModelUnloaded();
      }
      return false;
    } finally {
      // Only clear state if this generation is still the active one
      if (activeGenerationIdRef.current === generationId) {
        // Clear any pending throttled updates and reset streaming state
        resetStreaming();
        setIsGenerating(false);
        isGeneratingRef.current = false;
        activeGenerationIdRef.current = null;
        activeConversationIdRef.current = null;

        // Safety net: dismiss ongoing notification if still showing
        notificationService.dismissOngoingGenerationNotification().catch(() => {});
      }
    }
  }, [settings, isPremium, openUpgradeModal, markActivated, updateStreamingContent, resetStreaming, isInBackgroundRef, getLatestContent, appendAssistantMessage, markModelUnloaded]);

  const sendMessage = useCallback(async (content: string, targetConversation?: Conversation, image?: ImageAttachment, document?: DocumentAttachment): Promise<boolean> => {
    // Use provided conversation or current one
    let conversation = targetConversation || currentConversationRef.current;

    if (!conversation) return false;

    // If user sends a new message while generating (or a stop is still
    // winding down), finish stopping first. The stop's saved partial reply
    // isn't in our snapshot yet (React hasn't re-rendered), so add it to the
    // history here; the state update itself already happened.
    if (isGeneratingRef.current || stopPromiseRef.current) {
      lastStoppedPartialRef.current = null;
      await stopGeneration();
      const partial = lastStoppedPartialRef.current as { conversationId: string; message: Message } | null;
      if (partial && partial.conversationId === conversation.id && !conversation.messages.some(m => m.id === partial.message.id)) {
        conversation = { ...conversation, messages: [...conversation.messages, partial.message] };
      }
    }

    // Once a rolling summary exists it stands in for the messages it covers,
    // so the LLM only sees the summary plus the live tail of the history.
    const contextSummary = conversation.contextSummary;
    const coveredCount = Math.min(contextSummary?.coversMessageCount ?? 0, conversation.messages.length);
    const liveMessages = coveredCount > 0 ? conversation.messages.slice(coveredCount) : conversation.messages;

    const taskType = getTaskType(content, image, document);
    const generationStartedAt = Date.now();
    const taskAnalyticsParams = {
      ...getCurrentModelAnalyticsParams('chat', isPremium),
      task_type: taskType,
      message_count_before: conversation.messages.length,
      has_image: Boolean(image),
      has_document: Boolean(document),
      content_length: content.length,
      document_size_bytes: document?.size,
    };
    void analyticsService.trackTaskStarted(taskAnalyticsParams);
    void analyticsService.trackFirstPromptSent(taskAnalyticsParams);

    // Record activity for re-engagement scheduling, and ask for notification
    // permission on the first message (after the user has seen value).
    notificationService.recordActivity().catch(() => {});
    notificationService.requestPermissionAfterFirstMessage().catch(() => {});

    const generationId = beginGeneration(conversation.id);

    // Semantic recall (premium, optional download — recall() no-ops when
    // unavailable) and message building (document token-budget truncation)
    // are independent native work; run them concurrently.
    const recallPromise: Promise<string | null> =
      isPremium && coveredCount > 0 && content.trim()
        ? recallService.recall(conversation, content, coveredCount).catch(() => null)
        : Promise.resolve(null);
    const [recallContext, { userMessage, llmUserMessage }] = await Promise.all([
      recallPromise,
      buildUserMessages({ content, image, document, liveMessages }),
    ]);
    const sentConversation = conversation;

    setConversations(prev => prev.map(c => {
      if (c.id === sentConversation.id) {
        const updated = {
          ...c,
          messages: [...c.messages, userMessage],
          updatedAt: Date.now(),
        };
        if (c.messages.length === 0) {
          updated.title = generateTitle([userMessage]);
        }
        return updated;
      }
      return c;
    }));

    setCurrentConversation(prev => {
      if (!prev || prev.id !== sentConversation.id) {
        // Update to the target conversation with the new message
        return {
          ...sentConversation,
          messages: [...sentConversation.messages, userMessage],
          updatedAt: Date.now(),
          title: sentConversation.messages.length === 0 ? generateTitle([userMessage]) : sentConversation.title,
        };
      }
      const updated = {
        ...prev,
        messages: [...prev.messages, userMessage],
        updatedAt: Date.now(),
      };
      if (prev.messages.length === 0) {
        updated.title = generateTitle([userMessage]);
      }
      return updated;
    });

    return runGenerationLoop({
      generationId,
      conversationId: conversation.id,
      llmMessages: [...liveMessages, llmUserMessage],
      buildFinalMessages: (existingMessages, assistantMessage) => [
        ...existingMessages.filter(m => m.id !== userMessage.id),
        userMessage,
        assistantMessage,
      ],
      taskAnalyticsParams,
      generationStartedAt,
      isResend: false,
      contextSummary: contextSummary?.text ?? null,
      recallContext,
    });
  }, [stopGeneration, isPremium, beginGeneration, runGenerationLoop]);

  const updateSettings = useCallback((newSettings: Partial<AppSettings>) => {
    if (newSettings.enableSpeculative !== undefined) {
      llmService.setSpeculativeEnabled(Boolean(newSettings.enableSpeculative));
    }
    setSettings(prev => {
      const updated = { ...prev, ...newSettings };
      saveSettings(updated);
      return updated;
    });
  }, []);

  const clearAllChats = useCallback(() => {
    void stopGeneration();
    setConversations([]);
    setCurrentConversation(null);
    void clearConversationRows();
    void recallService.clearAllIndexes();
  }, [stopGeneration]);

  // Resend a message from a specific point, optionally with edited content
  const resendMessage = useCallback(async (messageId: string, newContent?: string) => {
    // If user resends while generating (or a stop is winding down), finish
    // stopping first
    if (isGeneratingRef.current || stopPromiseRef.current) {
      await stopGeneration();
    }

    const currentConversation = currentConversationRef.current;
    if (!currentConversation) return;

    // Find the message index
    const messageIndex = currentConversation.messages.findIndex(m => m.id === messageId);
    if (messageIndex === -1) return;

    const originalMessage = currentConversation.messages[messageIndex];
    if (originalMessage.role !== 'user') return; // Can only resend user messages

    // Get messages up to (but not including) this message
    const previousMessages = currentConversation.messages.slice(0, messageIndex);
    const conversationId = currentConversation.id;

    // The rolling summary is only usable if the resend point lies beyond the
    // messages it covers; otherwise it describes turns being rewritten, so
    // drop it and fall back to the raw history.
    const existingSummary = currentConversation.contextSummary;
    const contextSummary = existingSummary && existingSummary.coversMessageCount <= messageIndex
      ? existingSummary
      : undefined;
    const livePreviousMessages = contextSummary
      ? previousMessages.slice(contextSummary.coversMessageCount)
      : previousMessages;

    // Create the new/edited message
    const content = newContent !== undefined ? newContent : originalMessage.content;
    // Keep the attachment metadata (and in-session document text) so the
    // regenerated answer sees the same input as the original.
    const userMessage = createMessage('user', content, stripImageBase64(originalMessage.image), undefined, undefined, originalMessage.document);
    const llmUserMessage = {
      ...userMessage,
      image: originalMessage.image,
    };
    const generationStartedAt = Date.now();
    const taskAnalyticsParams = {
      ...getCurrentModelAnalyticsParams('resend', isPremium),
      task_type: getTaskType(content, originalMessage.image),
      message_count_before: previousMessages.length,
      has_image: Boolean(originalMessage.image),
      has_document: Boolean(originalMessage.document),
      content_length: content.length,
    };
    void analyticsService.trackTaskStarted(taskAnalyticsParams);

    // Update conversation with truncated history + new message
    const updatedConversation = {
      ...currentConversation,
      messages: [...previousMessages, userMessage],
      updatedAt: Date.now(),
      contextSummary,
    };

    setCurrentConversation(updatedConversation);
    setConversations(prev => prev.map(c =>
      c.id === conversationId ? updatedConversation : c
    ));

    const generationId = beginGeneration(conversationId);

    await runGenerationLoop({
      generationId,
      conversationId,
      llmMessages: [...livePreviousMessages, llmUserMessage],
      buildFinalMessages: (_existingMessages, assistantMessage) => [
        ...previousMessages,
        userMessage,
        assistantMessage,
      ],
      taskAnalyticsParams,
      generationStartedAt,
      isResend: true,
      contextSummary: contextSummary?.text ?? null,
    });
  }, [stopGeneration, isPremium, beginGeneration, runGenerationLoop]);

  const regenerateMessage = useCallback(async (assistantMessageId: string) => {
    const messages = currentConversationRef.current?.messages ?? [];
    const index = messages.findIndex(m => m.id === assistantMessageId);
    for (let i = index - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        await resendMessage(messages[i].id);
        return;
      }
    }
  }, [resendMessage]);

  // Memoize the context value so consumers only re-render when something
  // they can see changes (streaming text is in StreamingContext).
  const contextValue = useMemo<ChatContextType>(() => ({
    conversations,
    currentConversation,
    settings,
    isLoading,
    isGenerating,
    modelLoaded,
    modelLoadProgress,
    modelStatus,
    modelError,
    showDownloadModal,
    showModelSelection,
    downloadingModelId,
    visionEnabled,
    setCurrentConversation: switchConversation,
    createNewChat,
    deleteConversation,
    sendMessage,
    resendMessage,
    regenerateMessage,
    stopGeneration,
    updateSettings,
    loadModel,
    startDownload,
    startDownloadForModel,
    selectModel,
    handleModelDeleted,
    cancelDownload,
    dismissDownloadModal,
    showDownloadPrompt,
    clearAllChats,
  }), [
    conversations,
    currentConversation,
    settings,
    isLoading,
    isGenerating,
    modelLoaded,
    modelLoadProgress,
    modelStatus,
    modelError,
    showDownloadModal,
    showModelSelection,
    downloadingModelId,
    visionEnabled,
    switchConversation,
    createNewChat,
    deleteConversation,
    sendMessage,
    resendMessage,
    regenerateMessage,
    stopGeneration,
    updateSettings,
    loadModel,
    startDownload,
    startDownloadForModel,
    selectModel,
    handleModelDeleted,
    cancelDownload,
    dismissDownloadModal,
    showDownloadPrompt,
    clearAllChats,
  ]);

  return (
    <ChatContext.Provider value={contextValue}>
      <StreamingContext.Provider value={streaming}>
        {children}
      </StreamingContext.Provider>
    </ChatContext.Provider>
  );
}

export function useChat() {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return context;
}

/** The in-flight reply's text and the conversation it belongs to. */
export function useStreaming() {
  return useContext(StreamingContext);
}
