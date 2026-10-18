import { useState, useRef, useCallback } from 'react';

export interface StreamingState {
  /** Visible text of the in-flight reply ('' when idle). */
  content: string;
  /** Conversation the in-flight reply belongs to (null when idle). */
  conversationId: string | null;
}

const IDLE: StreamingState = { content: '', conversationId: null };

// Streaming-content state with throttled UI updates. The ref always holds
// the latest clean content; state updates are throttled to 150ms to keep
// the UI responsive while reducing layout churn and JS/native bridge
// pressure on slower Android devices.
export function useStreamingContent() {
  const [streaming, setStreaming] = useState<StreamingState>(IDLE);
  const streamingContentRef = useRef('');
  const conversationIdRef = useRef<string | null>(null);
  const streamingThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startStreaming = useCallback((conversationId: string) => {
    streamingContentRef.current = '';
    conversationIdRef.current = conversationId;
    setStreaming({ content: '', conversationId });
  }, []);

  const updateStreamingContent = useCallback((cleanContent: string) => {
    streamingContentRef.current = cleanContent;

    // Throttle streaming updates to prevent excessive re-renders.
    if (!streamingThrottleRef.current) {
      streamingThrottleRef.current = setTimeout(() => {
        streamingThrottleRef.current = null;
        setStreaming({ content: streamingContentRef.current, conversationId: conversationIdRef.current });
      }, 150);
    }
  }, []);

  // Clear any pending throttled updates
  const clearPendingThrottle = useCallback(() => {
    if (streamingThrottleRef.current) {
      clearTimeout(streamingThrottleRef.current);
      streamingThrottleRef.current = null;
    }
  }, []);

  /** Latest streamed text, including tokens not yet flushed to state. */
  const getLatestContent = useCallback(() => streamingContentRef.current, []);

  // Full reset: cancel any pending throttled flush and clear both the
  // displayed state and the latest-content ref.
  const resetStreaming = useCallback(() => {
    clearPendingThrottle();
    streamingContentRef.current = '';
    conversationIdRef.current = null;
    setStreaming(IDLE);
  }, [clearPendingThrottle]);

  return {
    streaming,
    startStreaming,
    updateStreamingContent,
    clearPendingThrottle,
    getLatestContent,
    resetStreaming,
  };
}
