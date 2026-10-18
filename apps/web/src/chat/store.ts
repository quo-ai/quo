import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Conversation } from './types';

/**
 * Chats live in IndexedDB on this device only. One record per conversation;
 * writes happen per completed turn, never per streamed token.
 */

interface QuoDB extends DBSchema {
  conversations: {
    key: string;
    value: Conversation;
    indexes: { updatedAt: number };
  };
}

let dbPromise: Promise<IDBPDatabase<QuoDB>> | null = null;

function db(): Promise<IDBPDatabase<QuoDB>> {
  dbPromise ??= openDB<QuoDB>('quo', 1, {
    upgrade(database) {
      const store = database.createObjectStore('conversations', { keyPath: 'id' });
      store.createIndex('updatedAt', 'updatedAt');
    },
  });
  return dbPromise;
}

/** Newest first. */
export async function listConversations(): Promise<Conversation[]> {
  const all = await (await db()).getAllFromIndex('conversations', 'updatedAt');
  return all.reverse();
}

export async function saveConversation(conversation: Conversation): Promise<void> {
  await (await db()).put('conversations', conversation);
}

export async function deleteConversation(id: string): Promise<void> {
  await (await db()).delete('conversations', id);
}

export function titleFrom(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > 48 ? `${line.slice(0, 47).trimEnd()}…` : line || 'New chat';
}
