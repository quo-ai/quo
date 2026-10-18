import React, { memo, useEffect } from 'react';
import { useStreaming } from '@/contexts/ChatContext';
import { StreamingBubble } from '@/components/StreamingBubble';
import { LoadingIndicator } from '@/components/LoadingIndicator';

// Streaming text changes every ~150ms. Only the components in this file
// subscribe to it, so ChatScreen (and its message list) doesn't re-render
// on every tick.

interface StreamingFooterProps {
  conversationId: string | undefined;
  isGenerating: boolean;
}

/** The in-flight reply (or a thinking indicator) for the shown conversation. */
export const StreamingFooter = memo(function StreamingFooter({ conversationId, isGenerating }: StreamingFooterProps) {
  const streaming = useStreaming();
  // A reply streaming in another conversation must not show up in this one.
  const content = streaming.conversationId !== null && streaming.conversationId === conversationId
    ? streaming.content
    : '';

  if (content) return <StreamingBubble content={content} />;
  if (isGenerating) return <LoadingIndicator message="Thinking..." />;
  return null;
});

export interface StreamStatus {
  /** Conversation the in-flight reply belongs to (null when idle). */
  streamConversationId: string | null;
  /** The shown conversation has visible streamed text. */
  hasStreamingContent: boolean;
}

interface StreamStatusBridgeProps {
  conversationId: string | undefined;
  onChange: (status: StreamStatus) => void;
}

/**
 * Renders nothing; reports the coarse streaming status to its parent only
 * when it actually changes (not on every content tick).
 */
export const StreamStatusBridge = memo(function StreamStatusBridge({ conversationId, onChange }: StreamStatusBridgeProps) {
  const streaming = useStreaming();
  const streamConversationId = streaming.conversationId;
  const hasStreamingContent = streamConversationId !== null
    && streamConversationId === conversationId
    && streaming.content !== '';

  useEffect(() => {
    onChange({ streamConversationId, hasStreamingContent });
  }, [streamConversationId, hasStreamingContent, onChange]);

  return null;
});
