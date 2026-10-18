import { useEffect, Dispatch, SetStateAction, MutableRefObject } from 'react';
import { InteractionManager } from 'react-native';
import { Conversation } from '@/types/chat';
import { llmService } from '@/services/llm';
import { recallService } from '@/services/recallService';
import { analyticsService } from '@/services/analyticsService';

// Roll old messages into a compact summary while the app is idle, so long
// conversations keep their early content as a digest instead of silently
// forgetting it when the context window fills. The summary then replaces
// those messages in the prompt, which also keeps prefill fast.
export function useContextCompression({
  currentConversation,
  setCurrentConversation,
  setConversations,
  isLoading,
  isGenerating,
  isGeneratingRef,
  modelLoaded,
  isPremium,
}: {
  currentConversation: Conversation | null;
  setCurrentConversation: Dispatch<SetStateAction<Conversation | null>>;
  setConversations: Dispatch<SetStateAction<Conversation[]>>;
  isLoading: boolean;
  isGenerating: boolean;
  isGeneratingRef: MutableRefObject<boolean>;
  modelLoaded: boolean;
  isPremium: boolean;
}) {
  useEffect(() => {
    if (isLoading || isGenerating || !modelLoaded || !currentConversation) return;
    if (currentConversation.messages.length === 0) return;

    const conversation = currentConversation;
    let cancelled = false;

    const task = InteractionManager.runAfterInteractions(async () => {
      // Let the UI settle after a generation before burning cycles.
      await new Promise(resolve => setTimeout(resolve, 2000));
      if (cancelled || isGeneratingRef.current) return;

      // Keep the semantic recall index fresh (separate embedding context, so
      // it cannot interfere with the chat model). No-op unless enabled.
      if (isPremium) {
        await recallService.indexConversation(conversation).catch(() => {});
        if (cancelled || isGeneratingRef.current) return;
      }

      // No-ops quickly unless the live history crosses the size threshold;
      // a user generation aborts it via llmService.cancelSummarization().
      const updated = await llmService.compressConversationContext(
        conversation.messages,
        conversation.contextSummary ?? null,
      );
      if (cancelled || !updated) return;

      void analyticsService.track('context_compressed', {
        covered_messages: updated.coversMessageCount,
        summary_chars: updated.text.length,
      });

      setConversations(prev => prev.map(c =>
        c.id === conversation.id ? { ...c, contextSummary: updated } : c
      ));
      setCurrentConversation(prev =>
        prev && prev.id === conversation.id ? { ...prev, contextSummary: updated } : prev
      );
    });

    return () => {
      cancelled = true;
      task.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentConversation, isGenerating, isLoading, modelLoaded, isPremium]);
}
