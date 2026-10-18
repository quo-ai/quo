import React from 'react';
import { Message } from '@/types/chat';
import { UserBubble } from '@/components/message/UserBubble';
import { AssistantBubble } from '@/components/message/AssistantBubble';

interface MessageBubbleProps {
  message: Message;
  /** Re-run from a user message, optionally with edited text. */
  onResend?: (messageId: string, newContent?: string) => void;
  /** Regenerate an assistant reply. */
  onRegenerate?: (assistantMessageId: string) => void;
  isGenerating?: boolean;
  showStats?: boolean;
}

// Finished messages only — the in-flight reply renders in StreamingBubble.
export function MessageBubble({ message, onResend, onRegenerate, isGenerating, showStats }: MessageBubbleProps) {
  if (message.role === 'user') {
    return <UserBubble message={message} onResend={onResend} isGenerating={isGenerating} />;
  }
  return (
    <AssistantBubble
      message={message}
      onRegenerate={onRegenerate}
      isGenerating={isGenerating}
      showStats={showStats}
    />
  );
}

export const MemoizedMessageBubble = React.memo(
  MessageBubble,
  (prevProps, nextProps) => {
    const prev = prevProps.message;
    const next = nextProps.message;
    return (
      prev.id === next.id &&
      prev.content === next.content &&
      prev.timestamp === next.timestamp &&
      prev.toolActions === next.toolActions &&
      prev.stats === next.stats &&
      prev.image?.uri === next.image?.uri &&
      prev.document?.name === next.document?.name &&
      prevProps.isGenerating === nextProps.isGenerating &&
      prevProps.showStats === nextProps.showStats &&
      prevProps.onResend === nextProps.onResend &&
      prevProps.onRegenerate === nextProps.onRegenerate
    );
  }
);
