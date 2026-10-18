import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { randomUUID } from 'expo-crypto';
import { keyFromHex, keyToHex } from './crypto';
import type { Tracked, TrackingStore } from './engine';

/**
 * This phone's side of Quo Sync, kept on the device: the encryption key and the
 * sign-in token in the system's secure storage (Android Keystore), and what it
 * knows about each record's state on the server in ordinary app storage.
 */

export interface SyncSettings {
  email: string;
  startedAt: number;
  lastSyncAt: number | null;
}

const PREFIX = 'quo_sync:';
const RECORD = (id: string) => `${PREFIX}rec:${id}`;
const DIRTY_KEY = `${PREFIX}dirty`;
const SEQ_KEY = `${PREFIX}seq`;
const SETTINGS_KEY = `${PREFIX}settings`;
const DEVICE_KEY = `${PREFIX}device`;
const SECURE_KEY = 'quo.sync.key';
const SECURE_TOKEN = 'quo.sync.token';

// Writes to the list of changed records take turns, so two can't overwrite each other.
let queue: Promise<unknown> = Promise.resolve();
const exclusive = <T>(task: () => Promise<T>): Promise<T> => {
  const run = queue.then(task, task);
  queue = run.catch(() => {});
  return run;
};

async function readDirty(): Promise<string[]> {
  try {
    const parsed: unknown = JSON.parse((await AsyncStorage.getItem(DIRTY_KEY)) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export const trackingStore: TrackingStore = {
  async get(id) {
    const raw = await AsyncStorage.getItem(RECORD(id));
    return raw ? (JSON.parse(raw) as Tracked) : undefined;
  },

  put: record =>
    exclusive(async () => {
      const dirty = await readDirty();
      const has = dirty.includes(record.id);
      await AsyncStorage.setItem(RECORD(record.id), JSON.stringify(record));
      if (record.dirty && !has) await AsyncStorage.setItem(DIRTY_KEY, JSON.stringify([...dirty, record.id]));
      else if (!record.dirty && has) await AsyncStorage.setItem(DIRTY_KEY, JSON.stringify(dirty.filter(id => id !== record.id)));
    }),

  remove: id =>
    exclusive(async () => {
      const dirty = await readDirty();
      await AsyncStorage.removeItem(RECORD(id));
      if (dirty.includes(id)) await AsyncStorage.setItem(DIRTY_KEY, JSON.stringify(dirty.filter(item => item !== id)));
    }),

  async dirty() {
    const ids = await readDirty();
    if (ids.length === 0) return [];
    const rows = await AsyncStorage.multiGet(ids.map(RECORD));
    return rows.flatMap(([, value]) => {
      const record = value ? (JSON.parse(value) as Tracked) : null;
      return record?.dirty ? [record] : [];
    });
  },

  async getSeq() {
    return Number.parseInt((await AsyncStorage.getItem(SEQ_KEY)) ?? '0', 10) || 0;
  },

  setSeq: seq => AsyncStorage.setItem(SEQ_KEY, String(seq)),
};

/** Sync as this phone last left it: null if it was never turned on, or the key is gone (a restored backup has the app's data but not the Keystore's). */
export async function loadSetup(): Promise<{ key: Uint8Array; settings: SyncSettings } | null> {
  const raw = await AsyncStorage.getItem(SETTINGS_KEY);
  if (!raw) return null;
  const hex = await SecureStore.getItemAsync(SECURE_KEY).catch(() => null);
  if (!hex) {
    await clearSetup();
    return null;
  }
  try {
    return { key: keyFromHex(hex), settings: JSON.parse(raw) as SyncSettings };
  } catch {
    await clearSetup();
    return null;
  }
}

export async function saveSetup(key: Uint8Array, settings: SyncSettings): Promise<void> {
  await SecureStore.setItemAsync(SECURE_KEY, keyToHex(key));
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export const saveSettings = (settings: SyncSettings): Promise<void> => AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));

/** Forgets everything about syncing on this phone (chats and memories stay; so does the sign-in). */
export async function clearSetup(): Promise<void> {
  await exclusive(async () => {
    const keys = (await AsyncStorage.getAllKeys()).filter(key => key.startsWith(PREFIX) && key !== DEVICE_KEY);
    if (keys.length > 0) await AsyncStorage.multiRemove(keys);
  });
  await SecureStore.deleteItemAsync(SECURE_KEY).catch(() => {});
}

export const getToken = (): Promise<string | null> => SecureStore.getItemAsync(SECURE_TOKEN).catch(() => null);
export const saveToken = (token: string): Promise<void> => SecureStore.setItemAsync(SECURE_TOKEN, token);
export const clearToken = (): Promise<void> => SecureStore.deleteItemAsync(SECURE_TOKEN).catch(() => {});

/** A random id for this install, sent with requests (the server uses it for rate limits, never to identify you). */
export async function getDeviceId(): Promise<string> {
  const existing = await AsyncStorage.getItem(DEVICE_KEY);
  if (existing) return existing;
  const id = randomUUID();
  await AsyncStorage.setItem(DEVICE_KEY, id);
  return id;
}
