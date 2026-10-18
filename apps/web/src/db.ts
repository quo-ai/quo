import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Conversation } from './chat/types';
import type { Memory } from './memory/store';

/**
 * The app's one database: chats and memories, on this device only. Opened here
 * so every store shares one version history.
 *
 *   v1  conversations
 *   v2  memories
 */

interface QuoDB extends DBSchema {
  conversations: {
    key: string;
    value: Conversation;
    indexes: { updatedAt: number };
  };
  memories: {
    key: string;
    value: Memory;
    indexes: { createdAt: number };
  };
}

let dbPromise: Promise<IDBPDatabase<QuoDB>> | null = null;

export function quoDb(): Promise<IDBPDatabase<QuoDB>> {
  dbPromise ??= openDB<QuoDB>('quo', 2, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) {
        const conversations = database.createObjectStore('conversations', { keyPath: 'id' });
        conversations.createIndex('updatedAt', 'updatedAt');
      }
      if (oldVersion < 2) {
        const memories = database.createObjectStore('memories', { keyPath: 'id' });
        memories.createIndex('createdAt', 'createdAt');
      }
    },
    // A tab running an older version is holding the old database open: let go, so this one can upgrade it.
    blocking(_current, _blocked, event) {
      (event.target as IDBDatabase).close();
      dbPromise = null;
    },
  });
  return dbPromise;
}
