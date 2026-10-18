import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { Message } from '@/types/chat';

const NEAR_BOTTOM_PX = 120;
// How long after a scroll request content growth keeps following the bottom.
const PENDING_SCROLL_MS = 1500;

interface UseChatAutoScrollOptions {
  conversationId: string | undefined;
  messages: Message[];
  /** A reply is generating or streaming in the shown conversation. */
  isStreamActive: boolean;
}

/**
 * Stick-to-bottom behaviour for the chat list:
 * - follows the streaming reply while the user is at the bottom;
 * - a user drag away from the bottom pauses following (and shows the
 *   scroll-to-bottom pill) until they return or tap the pill;
 * - only the user's own new message re-engages following — the final
 *   assistant message landing never yanks a user who scrolled up.
 * Scrolls requested before layout settles (new message, conversation switch)
 * are kept pending and completed in onContentSizeChange, so a final bubble
 * taller than its streaming version doesn't end up under the input bar.
 */
export function useChatAutoScroll({ conversationId, messages, isStreamActive }: UseChatAutoScrollOptions) {
  const flatListRef = useRef<FlatList<Message>>(null);
  const userScrolledUpRef = useRef(false);
  const userDraggingRef = useRef(false);
  // Until when a requested scroll-to-end should follow content growth (the
  // new message measuring/laying out). Time-boxed so a later, unrelated size
  // change — expanding a block above, an image loading — doesn't yank the
  // list to the bottom.
  const pendingScrollUntilRef = useRef(0);
  const requestPendingScroll = () => {
    pendingScrollUntilRef.current = Date.now() + PENDING_SCROLL_MS;
  };
  // Land at the bottom on first layout.
  useEffect(() => {
    requestPendingScroll();
  }, []);
  const contentHeightRef = useRef(0);
  const layoutHeightRef = useRef(0);
  const lastMessageCountRef = useRef(messages.length);
  const lastConversationIdRef = useRef(conversationId);
  const isStreamActiveRef = useRef(isStreamActive);
  const [showPill, setShowPill] = useState(false);

  useEffect(() => {
    isStreamActiveRef.current = isStreamActive;
  }, [isStreamActive]);

  const scrollToEnd = useCallback((animated: boolean) => {
    flatListRef.current?.scrollToOffset({
      offset: Math.max(0, contentHeightRef.current - layoutHeightRef.current),
      animated,
    });
  }, []);

  useEffect(() => {
    const count = messages.length;

    if (conversationId !== lastConversationIdRef.current) {
      // Switched conversations: start at the bottom of the new one.
      lastConversationIdRef.current = conversationId;
      lastMessageCountRef.current = count;
      userScrolledUpRef.current = false;
      requestPendingScroll();
      return;
    }

    const isNewMessage = count > lastMessageCountRef.current;
    lastMessageCountRef.current = count;
    if (!isNewMessage) return;

    // The user's own message means they want to see the reply.
    if (messages[count - 1]?.role === 'user') {
      userScrolledUpRef.current = false;
    }
    if (userScrolledUpRef.current) return;
    requestPendingScroll();
    scrollToEnd(true);
  }, [conversationId, messages, scrollToEnd]);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    const isNearBottom = layoutMeasurement.height + contentOffset.y >= contentSize.height - NEAR_BOTTOM_PX;
    if (isNearBottom) {
      userScrolledUpRef.current = false;
    } else if (userDraggingRef.current) {
      // Only a user gesture counts as "scrolled up" — not our own animated
      // scrolls or content growing under a still list.
      userScrolledUpRef.current = true;
    }
    if (isStreamActiveRef.current) {
      setShowPill(userScrolledUpRef.current);
    }
  }, []);

  const onContentSizeChange = useCallback((_w: number, h: number) => {
    contentHeightRef.current = h;
    if (userScrolledUpRef.current) return;
    if (isStreamActiveRef.current || Date.now() < pendingScrollUntilRef.current) {
      scrollToEnd(false);
    }
  }, [scrollToEnd]);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    layoutHeightRef.current = e.nativeEvent.layout.height;
  }, []);

  const onScrollBeginDrag = useCallback(() => {
    userDraggingRef.current = true;
    pendingScrollUntilRef.current = 0;
  }, []);
  const onMomentumScrollBegin = useCallback(() => {
    userDraggingRef.current = true;
  }, []);
  const onScrollEnd = useCallback(() => {
    userDraggingRef.current = false;
  }, []);

  const scrollToBottom = useCallback(() => {
    userScrolledUpRef.current = false;
    requestPendingScroll();
    setShowPill(false);
    scrollToEnd(true);
  }, [scrollToEnd]);

  /** Call when the user sends: follow their message and the reply. */
  const resetForSend = useCallback(() => {
    userScrolledUpRef.current = false;
    setShowPill(false);
  }, []);

  const listProps = useMemo(() => ({
    onScroll,
    onContentSizeChange,
    onLayout,
    onScrollBeginDrag,
    onScrollEndDrag: onScrollEnd,
    onMomentumScrollBegin,
    onMomentumScrollEnd: onScrollEnd,
  }), [onScroll, onContentSizeChange, onLayout, onScrollBeginDrag, onScrollEnd, onMomentumScrollBegin]);

  return {
    flatListRef,
    listProps,
    /** The floating scroll-to-bottom pill: only while a reply is in flight. */
    showScrollToBottom: showPill && isStreamActive,
    scrollToBottom,
    resetForSend,
  };
}
