import type { MutableRefObject } from 'react';
import { deleteConversationRows } from '@/services/storage';
import type { ChatBridge } from '@/services/sync/bridge';
import { chatFingerprint } from '@/services/sync/convert';
import type { Conversation } from '@/types/chat';

/** Adds a chat, or replaces the one with the same id, keeping the list newest first. */
export function upsertConversation(list: Conversation[], conversation: Conversation): Conversation[] {
  if (list.some(c => c.id === conversation.id)) return list.map(c => (c.id === conversation.id ? conversation : c));
  const at = list.findIndex(c => c.updatedAt <= conversation.updatedAt);
  return at === -1 ? [...list, conversation] : [...list.slice(0, at), conversation, ...list.slice(at)];
}

interface Dependencies {
  /** The chats, as they are right now (ChatContext keeps them in a ref as well as in state). */
  conversations: MutableRefObject<Conversation[]>;
  setConversations: (update: (previous: Conversation[]) => Conversation[]) => void;
  setCurrentConversation: (update: (previous: Conversation | null) => Conversation | null) => void;
  flush: () => Promise<void>;
  busy: () => boolean;
  /** Anything that goes with a chat and should go when it does (its search index). */
  onRemoved?: (id: string) => void;
}

/**
 * What Quo Sync does to the chat screen's state (see services/sync/bridge.ts).
 * Each write first checks the chat is as sync last read it, so an edit made in
 * the meantime is never overwritten; it just tries again a moment later.
 */
export function createChatBridge(deps: Dependencies): ChatBridge {
  const unchanged = (id: string, expected: string | null): boolean => {
    const existing = deps.conversations.current.find(c => c.id === id);
    return (existing ? chatFingerprint(existing) : null) === expected;
  };

  return {
    getAll: () => deps.conversations.current,

    apply(conversation, expected) {
      if (!unchanged(conversation.id, expected)) return false;
      deps.setConversations(previous => upsertConversation(previous, conversation));
      deps.setCurrentConversation(previous => (previous?.id === conversation.id ? conversation : previous));
      return true;
    },

    remove(id, expected) {
      if (!unchanged(id, expected)) return false;
      deps.setConversations(previous => previous.filter(c => c.id !== id));
      deps.setCurrentConversation(previous => (previous?.id === id ? null : previous));
      // Quiet: the chat was deleted somewhere else, so there's nothing to tell sync.
      void deleteConversationRows([id], { quiet: true });
      deps.onRemoved?.(id);
      return true;
    },

    flush: deps.flush,
    busy: deps.busy,
  };
}
