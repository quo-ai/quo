import type { Conversation } from '@/types/chat';

/**
 * How Quo Sync reaches the chats. They live in the chat screen's state (saved to
 * disk a moment after each change), so that, not the disk, is what's true; the
 * chat context registers this bridge and sync reads and writes through it.
 */
export interface ChatBridge {
  /** Every chat, as it is right now (including edits not yet written to disk). */
  getAll(): Conversation[];
  /**
   * Adds or replaces a chat. `expected` is the chat's fingerprint (chatFingerprint)
   * when sync last read it, or null if it didn't exist; if it has changed since,
   * nothing is written and this returns false, so an edit made meanwhile is never overwritten.
   */
  apply(conversation: Conversation, expected: string | null): boolean;
  /** Removes a chat, with the same check. */
  remove(id: string, expected: string | null): boolean;
  /** Writes any edit still waiting to be saved, so the disk and sync agree. */
  flush(): Promise<void>;
  /** A reply is being written, or the history hasn't loaded yet: not a moment to sync. */
  busy(): boolean;
}

let current: ChatBridge | null = null;

export function registerChatBridge(bridge: ChatBridge): () => void {
  current = bridge;
  return () => {
    if (current === bridge) current = null;
  };
}

export const getChatBridge = (): ChatBridge | null => current;
