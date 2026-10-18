import { useSyncExternalStore } from 'react';
import { onConversationChange } from '../chat/store';
import { onMemoryChange } from '../memory/store';
import { api, ApiError } from '../cloud/api';
import { webChatStorage, webMemoryStorage } from './adapters';
import { checkVerifier, deriveKey, makeVerifier, parseRecoveryKey, webCodec } from './crypto';
import { SyncEngine, SyncStateError, type SyncApi } from './engine';
import { chatKind, memoryKind } from './kinds';
import { clearSetup, loadSetup, saveSettings, saveSetup, trackingStore, type SyncSettings } from './storage';

/**
 * Quo Sync on this device: turns it on and off, and keeps chats in step with
 * the user's other devices in the background. The engine (engine.ts) does the
 * merging; this decides when to run it and what to tell the user.
 *
 * It runs shortly after a chat is saved, when the app regains focus or comes
 * back online, and every few minutes. It never runs while a reply is being
 * written, so a chat can't change underneath its own generation.
 */

export interface SyncStatus {
  phase: 'off' | 'idle' | 'syncing' | 'error';
  email: string | null;
  lastSyncAt: number | null;
  error: { code: string; message: string } | null;
  /** Chats that couldn't be read or were too big to sync. */
  skipped: number;
  tooLarge: number;
}

const OFF: SyncStatus = { phase: 'off', email: null, lastSyncAt: null, error: null, skipped: 0, tooLarge: 0 };
const AFTER_CHANGE_MS = 4_000;
const REGULAR_MS = 3 * 60_000;
const MIN_GAP_MS = 15_000;
// These need the user to do something, so syncing stops trying until they act.
const NEEDS_ACTION = ['cloud_reset', 'key_changed', 'sync_required', 'sign_in_required', 'setup_required', 'quota_exceeded'];

const remoteApi: SyncApi = {
  status: () => api('sync/status'),
  pull: (since, kinds) => api(`sync/pull?since=${since}&kinds=${kinds.join(',')}`),
  push: records => api('sync/push', { body: { records } }),
};

let status: SyncStatus = OFF;
let engine: SyncEngine | null = null;
let settings: SyncSettings | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let running: Promise<void> | null = null;
let rerun = false;
let blocked = false;
let lastRunAt = 0;
let generating = 0;
let started = false;
// Changes still being written down as "to upload"; a sync waits for them so none is missed.
let pendingMarks: Promise<unknown> = Promise.resolve();
const listeners = new Set<() => void>();
const remoteListeners = new Set<() => void>();

function setStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch };
  listeners.forEach(listener => listener());
}

export const getSyncStatus = (): SyncStatus => status;

export function subscribeSync(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const useSyncStatus = (): SyncStatus => useSyncExternalStore(subscribeSync, getSyncStatus);

/** Called after chats arrive from another device, so the app can reload its list. */
export function onSyncedChats(listener: () => void): () => void {
  remoteListeners.add(listener);
  return () => remoteListeners.delete(listener);
}

/** Call around a reply being generated: sync waits until it's done. */
export function beginGeneration(): void {
  generating++;
}
export function endGeneration(): void {
  generating = Math.max(0, generating - 1);
}

function explain(error: unknown): { code: string; message: string } {
  if (error instanceof SyncStateError) {
    return error.code === 'cloud_reset'
      ? { code: error.code, message: 'The cloud copy was deleted from another device. Turn Quo Sync off here, then turn it on again to start over.' }
      : { code: error.code, message: 'The recovery key was changed on another device. Turn Quo Sync off here, then turn it on again with the new key.' };
  }
  if (error instanceof ApiError) {
    if (error.code === 'offline') return { code: 'offline', message: 'You’re offline. Quo Sync catches up when you’re back.' };
    if (error.code === 'sign_in_required') return { code: error.code, message: 'Sign in again to keep syncing.' };
    return { code: error.code, message: error.message };
  }
  console.error(error);
  return { code: 'failed', message: 'Syncing didn’t work. It will try again.' };
}

function makeEngine(key: CryptoKey): SyncEngine {
  return new SyncEngine({ api: remoteApi, codec: webCodec(key), stores: [chatKind(webChatStorage), memoryKind(webMemoryStorage)], tracking: trackingStore, newId: () => crypto.randomUUID() });
}

function schedule(delay: number) {
  clearTimeout(timer);
  timer = setTimeout(() => void syncNow(), delay);
}

/** Syncs now (soon, if a reply is being written). Safe to call at any time. */
export async function syncNow({ manual = false } = {}): Promise<void> {
  if (!engine) return;
  if (manual) blocked = false;
  if (blocked) return;
  if (generating > 0) return schedule(3_000);
  if (running) {
    rerun = true;
    return running;
  }
  const active = engine;
  setStatus({ phase: 'syncing', error: null });
  running = (async () => {
    try {
      await pendingMarks;
      const report = await active.run();
      lastRunAt = Date.now();
      if (settings) settings = { ...settings, lastSyncAt: lastRunAt };
      if (settings) await saveSettings(settings);
      setStatus({ phase: 'idle', lastSyncAt: lastRunAt, error: null, skipped: report.skipped, tooLarge: report.tooLarge });
      if (report.changed) remoteListeners.forEach(listener => listener());
    } catch (error) {
      const problem = explain(error);
      blocked = NEEDS_ACTION.includes(problem.code);
      setStatus({ phase: 'error', error: problem });
    }
  })();
  try {
    await running;
  } finally {
    running = null;
    if (rerun && engine === active) {
      rerun = false;
      schedule(1_000);
    }
  }
}

/** Loads sync from this device's saved setup and starts the background syncing. */
export async function initSync(): Promise<void> {
  if (started) return;
  started = true;

  const noteChange = (kind: 'chat' | 'memory') => (id: string, deleted: boolean) => {
    if (!engine) return;
    const active = engine;
    pendingMarks = pendingMarks.then(() => active.markChanged(kind, id, deleted)).then(() => schedule(AFTER_CHANGE_MS), () => {});
  };
  onConversationChange(noteChange('chat'));
  onMemoryChange(noteChange('memory'));
  const wake = () => {
    if (engine && !document.hidden && Date.now() - lastRunAt > MIN_GAP_MS) void syncNow();
  };
  window.addEventListener('focus', wake);
  window.addEventListener('online', wake);
  document.addEventListener('visibilitychange', wake);
  setInterval(wake, REGULAR_MS);

  const saved = await loadSetup().catch(() => null);
  if (!saved) return;
  engine = makeEngine(saved.key);
  settings = saved.settings;
  setStatus({ phase: 'idle', email: saved.settings.email, lastSyncAt: saved.settings.lastSyncAt });
  schedule(1_500);
}

async function begin(key: CryptoKey, email: string): Promise<void> {
  settings = { email, startedAt: Date.now(), lastSyncAt: null };
  await saveSetup(key, settings);
  engine = makeEngine(key);
  blocked = false;
  setStatus({ ...OFF, phase: 'idle', email });
  await engine.markAllDirty(); // what's already on this device goes up too
  void syncNow({ manual: true });
}

/** Turns Quo Sync on for this account with a new recovery key (shown to the user first). */
export async function createSync(secret: Uint8Array, email: string): Promise<void> {
  const key = await deriveKey(secret);
  await api('sync/setup', { body: { verifier: await makeVerifier(key) } });
  await begin(key, email);
}

export class JoinError extends Error {
  constructor(public code: 'bad_format' | 'not_set_up' | 'wrong_key') {
    super(code);
  }
}

/** Joins the account's existing Quo Sync with its recovery key, after checking the key is right. */
export async function joinSync(recoveryKey: string, email: string): Promise<void> {
  const secret = parseRecoveryKey(recoveryKey);
  if (!secret) throw new JoinError('bad_format');
  const key = await deriveKey(secret);
  const remote = await remoteApi.status();
  if (!remote.enabled || !remote.verifier) throw new JoinError('not_set_up');
  if (!(await checkVerifier(key, remote.verifier))) throw new JoinError('wrong_key');
  await begin(key, email);
}

/** Stops syncing on this device. The chats stay here and in the cloud. */
export async function disableSync(): Promise<void> {
  clearTimeout(timer);
  engine = null;
  settings = null;
  blocked = false;
  rerun = false;
  await clearSetup();
  setStatus({ ...OFF });
}

/** Deletes the cloud copy for good, then turns sync off here. Chats on this device stay. */
export async function deleteCloudCopy(): Promise<void> {
  await api('sync/reset', { body: {} });
  await disableSync();
}

export async function getCloudStatus(): Promise<{ entitled: boolean; enabled: boolean; usedBytes: number; limitBytes: number; records: number }> {
  return api('sync/status');
}
