import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  FlatList,
  Platform,
  TouchableOpacity,
  Animated,
  ListRenderItem,
} from 'react-native';
import { useChat } from '@/contexts/ChatContext';
import { MemoizedMessageBubble } from '@/components/MessageBubble';
import { ChatInput } from '@/components/ChatInput';
import { EmptyState } from '@/components/EmptyState';
import { ModelDownloadModal } from '@/components/ModelDownloadModal';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ReviewPrompt } from '@/components/ReviewPrompt';
import { ModelStatusBadge } from '@/components/chat/ModelStatusBadge';
import { StreamingFooter, StreamStatusBridge, type StreamStatus } from '@/components/chat/StreamingFooter';
import { useKeyboardInset } from '@/hooks/useKeyboardInset';
import { useChatAutoScroll } from '@/hooks/useChatAutoScroll';
import { useReviewPrompt } from '@/hooks/useReviewPrompt';
import { useUpgradeNudge } from '@/hooks/useUpgradeNudge';
import { UpgradeNudge } from '@/components/UpgradeNudge';
import { AnalyticsConsentPrompt } from '@/components/AnalyticsConsentPrompt';
import { useAnalyticsConsent } from '@/hooks/useAnalyticsConsent';
import { ImageAttachment, DocumentAttachment, Message } from '@/types/chat';
import { spacing, borderRadius } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/useTheme';
import { MessageSquarePlus, ChevronDown } from 'lucide-react-native';
import { llmService } from '@/services/llm';

const IDLE_STREAM_STATUS: StreamStatus = { streamConversationId: null, hasStreamingContent: false };
const EMPTY_MESSAGES: Message[] = [];

export default function ChatScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const {
    currentConversation,
    isGenerating: isGeneratingAnywhere,
    modelLoaded,
    modelLoadProgress,
    modelStatus,
    modelError,
    showDownloadModal,
    visionEnabled,
    settings,
    sendMessage,
    resendMessage,
    regenerateMessage,
    stopGeneration,
    startDownload,
    dismissDownloadModal,
    createNewChat,
    setCurrentConversation,
  } = useChat();
  const conversationId = currentConversation?.id;

  // Streaming text is consumed by StreamingFooter; this screen only gets the
  // coarse status (via StreamStatusBridge) so it doesn't re-render per tick.
  // A reply streaming in another conversation must not show up in this one.
  const [streamStatus, setStreamStatus] = useState<StreamStatus>(IDLE_STREAM_STATUS);
  const handleStreamStatus = useCallback((next: StreamStatus) => {
    setStreamStatus(prev => (
      prev.streamConversationId === next.streamConversationId
        && prev.hasStreamingContent === next.hasStreamingContent
        ? prev
        : next
    ));
  }, []);
  const { streamConversationId, hasStreamingContent } = streamStatus;
  const isGenerating = isGeneratingAnywhere
    && (streamConversationId === null || streamConversationId === conversationId);
  const isStreamActive = isGenerating || hasStreamingContent;

  const messages = currentConversation?.messages ?? EMPTY_MESSAGES;
  const keyboard = useKeyboardInset();
  const {
    flatListRef,
    listProps: autoScrollListProps,
    showScrollToBottom,
    scrollToBottom,
    resetForSend,
  } = useChatAutoScroll({ conversationId, messages, isStreamActive });
  const reviewPrompt = useReviewPrompt(isGeneratingAnywhere);
  const upgradeNudge = useUpgradeNudge(isGeneratingAnywhere);
  const analyticsConsent = useAnalyticsConsent(isGeneratingAnywhere);
  const onReviewAnswerCompleted = reviewPrompt.onAnswerCompleted;
  const onNudgeAnswerCompleted = upgradeNudge.onAnswerCompleted;
  // The one-time upgrade nudge gets first claim on the session's single
  // prompt slot; the review prompt still counts the answer either way.
  const onAnswerCompleted = useCallback(async () => {
    await onNudgeAnswerCompleted();
    await onReviewAnswerCompleted();
  }, [onNudgeAnswerCompleted, onReviewAnswerCompleted]);

  // Read these through refs so handleSend stays stable and the (memoized)
  // ChatInput doesn't re-render whenever a message lands (createNewChat
  // changes identity with the conversation list).
  const currentConversationRef = useRef(currentConversation);
  const createNewChatRef = useRef(createNewChat);
  useEffect(() => {
    currentConversationRef.current = currentConversation;
    createNewChatRef.current = createNewChat;
  }, [currentConversation, createNewChat]);

  const handleSend = useCallback(
    async (content: string, image?: ImageAttachment, document?: DocumentAttachment) => {
      resetForSend();
      const conversation = currentConversationRef.current || createNewChatRef.current();
      if (!conversation) return;
      const completed = await sendMessage(content, conversation, image, document);
      if (completed) await onAnswerCompleted();
    },
    [sendMessage, resetForSend, onAnswerCompleted],
  );

  const handleSuggestionPress = useCallback(
    (suggestion: string) => {
      void handleSend(suggestion);
    },
    [handleSend],
  );

  const showEmptyState = messages.length === 0 && !hasStreamingContent;
  const currentModelSize = llmService.getCurrentModel().size;
  const showStats = settings.showGenerationStats;

  const renderItem = useCallback<ListRenderItem<Message>>(({ item }) => (
    <MemoizedMessageBubble
      message={item}
      onResend={resendMessage}
      onRegenerate={regenerateMessage}
      isGenerating={isGenerating}
      showStats={showStats}
    />
  ), [resendMessage, regenerateMessage, isGenerating, showStats]);

  const listFooter = useMemo(
    () => <StreamingFooter conversationId={conversationId} isGenerating={isGenerating} />,
    [conversationId, isGenerating],
  );

  const handleNewChat = useCallback(() => {
    setCurrentConversation(null);
  }, [setCurrentConversation]);

  const ModelStatus = (
    <ModelStatusBadge
      modelLoaded={modelLoaded}
      modelStatus={modelStatus}
      progress={modelLoadProgress}
      onPress={startDownload}
    />
  );

  const NewChatButton = (
    <TouchableOpacity
      style={styles.newChatButton}
      onPress={handleNewChat}
      activeOpacity={0.7}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
    >
      <MessageSquarePlus size={22} color={colors.textSecondary} strokeWidth={1.5} />
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <StreamStatusBridge conversationId={conversationId} onChange={handleStreamStatus} />
      <ScreenHeader centerComponent={ModelStatus} rightComponent={NewChatButton} />

      <ModelDownloadModal
        visible={showDownloadModal}
        onConfirm={startDownload}
        onCancel={dismissDownloadModal}
        modelSize={currentModelSize}
        error={modelError}
        onRetry={startDownload}
      />

      {/* Message list — paddingBottom keeps content above the floating input bar */}
      <Animated.View style={[styles.content, { paddingBottom: keyboard.contentPaddingBottom }]}>
        {showEmptyState ? (
          <EmptyState
            type="chat"
            onSuggestionPress={modelLoaded ? handleSuggestionPress : undefined}
            isKeyboardVisible={keyboard.isKeyboardVisible}
          />
        ) : (
          <FlatList
            ref={flatListRef}
            data={messages}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            style={styles.messagesContainer}
            contentContainerStyle={styles.messagesContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            {...autoScrollListProps}
            scrollEventThrottle={64}
            windowSize={10}
            maxToRenderPerBatch={5}
            removeClippedSubviews={Platform.OS === 'android'}
            ListFooterComponent={listFooter}
          />
        )}
      </Animated.View>

      {/* Floating "scroll to bottom" button — visible when user scrolls up during generation */}
      {showScrollToBottom && (
        <Animated.View
          style={[styles.scrollToBottomWrap, { bottom: keyboard.contentPaddingBottom }]}
        >
          <TouchableOpacity
            style={styles.scrollToBottomButton}
            onPress={scrollToBottom}
            activeOpacity={0.8}
          >
            <ChevronDown size={20} color={colors.textPrimary} strokeWidth={2} />
          </TouchableOpacity>
        </Animated.View>
      )}

      {/* Input bar — absolute bottom; moves up with keyboard so input + image preview stay visible */}
      <Animated.View
        style={[styles.inputBar, { paddingBottom: spacing.sm, bottom: keyboard.inputBarBottom }]}
        onLayout={keyboard.onInputBarLayout}
      >
        <ChatInput
          onSend={handleSend}
          onStop={stopGeneration}
          isGenerating={isGenerating}
          disabled={!modelLoaded}
          visionEnabled={visionEnabled}
          isModelLoading={modelStatus === 'loading' || modelStatus === 'downloading'}
        />
      </Animated.View>

      <ReviewPrompt
        visible={reviewPrompt.visible}
        onDismiss={reviewPrompt.onDismiss}
        onRate={reviewPrompt.onRate}
      />
      <UpgradeNudge
        visible={upgradeNudge.visible}
        answers={upgradeNudge.answers}
        onUnlock={upgradeNudge.onUnlock}
        onDismiss={upgradeNudge.onDismiss}
      />
      <AnalyticsConsentPrompt
        visible={analyticsConsent.visible}
        onAllow={analyticsConsent.onAllow}
        onDecline={analyticsConsent.onDecline}
      />
    </View>
  );
}

const keyExtractor = (item: Message) => item.id;

const useStyles = makeStyles(({ colors, shadows }) => ({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
  },
  messagesContainer: {
    flex: 1,
  },
  messagesContent: {
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    flexGrow: 1,
  },
  inputBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: colors.background,
  },
  newChatButton: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollToBottomWrap: {
    position: 'absolute',
    alignSelf: 'center',
    zIndex: 10,
    marginBottom: spacing.sm,
  },
  scrollToBottomButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.soft,
  },
}));
