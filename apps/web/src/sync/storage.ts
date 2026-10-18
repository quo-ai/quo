import { openDB } from 'idb';
import type { Tracked, TrackingStore } from './engine';

/**
 * This device's side of Quo Sync, in its own database: the derived encryption
 * key (kept as a non-extractable CryptoKey, so even a script running in the page
 * can't read the key itself out), and what it knows about each chat's state on
 * the server. Chats themselves stay in the chat database.
 */

export interface SyncSettings {
  email: string;
  startedAt: number;
  lastSyncAt: number | null;
}

const db = () => openDB('quo-sync', 1, {
  upgrade(database) {
    database.createObjectStore('meta');
    database.createObjectStore('records', { keyPath: 'id' });
  },
});

let opened: ReturnType<typeof db> | null = null;
const open = () => (opened ??= db());

export async function loadSetup(): Promise<{ key: CryptoKey; settings: SyncSettings } | null> {
  const store = await open();
  const key = await store.get('meta', 'key');
  const settings = await store.get('meta', 'settings');
  return key && settings ? { key, settings } : null;
}

export async function saveSetup(key: CryptoKey, settings: SyncSettings): Promise<void> {
  const store = await open();
  await store.put('meta', key, 'key');
  await store.put('meta', settings, 'settings');
}

export async function saveSettings(settings: SyncSettings): Promise<void> {
  await (await open()).put('meta', settings, 'settings');
}

/** Forgets everything about syncing on this device (the chats stay). */
export async function clearSetup(): Promise<void> {
  const store = await open();
  await Promise.all([store.clear('meta'), store.clear('records')]);
}

export const trackingStore: TrackingStore = {
  get: async id => (await open()).get('records', id),
  put: async record => void (await (await open()).put('records', record)),
  remove: async id => (await open()).delete('records', id),
  dirty: async () => ((await (await open()).getAll('records')) as Tracked[]).filter(record => record.dirty),
  getSeq: async () => ((await (await open()).get('meta', 'seq')) as number | undefined) ?? 0,
  setSeq: async seq => void (await (await open()).put('meta', seq, 'seq')),
};
