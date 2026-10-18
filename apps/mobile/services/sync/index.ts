import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { memoryService } from '@/services/memory';
import { onConversationChanges } from '@/services/storage';
import { chatStorage, ConcurrentEditError, memoryStorage, NotReadyError } from './adapters';
import { api, ApiError, remoteApi } from './api';
import { getChatBridge } from './bridge';
import { checkVerifier, deriveKey, makeVerifier, mobileCodec, parseRecoveryKey } from './crypto';
import { SyncEngine, SyncStateError } from './engine';
import { chatKind, memoryKind } from './kinds';
import { clearSetup, clearToken, getToken, loadSetup, saveSettings, saveSetup, saveToken, trackingStore, type SyncSettings } from './tracking';

/**
 * Quo Sync on this phone: sign-in, turning it on and off, and keeping chats and
 * memories in step with the user's other devices. The engine (engine.ts, shared
 * with the web app) does the merging; this decides when to run it.
 *
 * It runs only while the app is open, shortly after something changes, when the
 * app comes back to the front, and every few minutes. It never runs while a reply
 * is being written, and writes any chat edit still waiting to be saved first, so
 * what it uploads and what it overwrites is what's really there.
 */

export interface SyncStatus {
  phase: 'off' | 'idle' | 'syncing' | 'error';
  email: string | null;
  lastSyncAt: number | null;
  error: { code: string; message: string } | null;
  /** Records that couldn't be read, or chats too big to sync. */
  skipped: number;
  tooLarge: number;
}

export interface Account {
  email: string;
  /** Quo Sync is included in this account's plan. */
  entitled: boolean;
}

const OFF: SyncStatus = { phase: 'off', email: null, lastSyncAt: null, error: null, skipped: 0, tooLarge: 0 };
const AFTER_CHANGE_MS = 4_000;
const REGULAR_MS = 3 * 60_000;
const MIN_GAP_MS = 15_000;
// These need the user to do something, so syncing stops trying until they act.
const NEEDS_ACTION = ['cloud_reset', 'key_changed', 'sync_required', 'sign_in_required', 'setup_required', 'quota_exceeded'];

let status: SyncStatus = OFF;
let account: Account | null = null;
let signedIn = false;
let engine: SyncEngine | null = null;
let settings: SyncSettings | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let running: Promise<void> | null = null;
let rerun = false;
let blocked = false;
let lastRunAt = 0;
let started = false;
// Changes being written down as "to upload"; a sync waits for them so none is missed.
let pendingMarks: Promise<unknown> = Promise.resolve();
const listeners = new Set<() => void>();

const emit = () => listeners.forEach(listener => listener());

function setStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch };
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const getSyncStatus = (): SyncStatus => status;
export const useSyncStatus = (): SyncStatus => useSyncExternalStore(subscribe, getSyncStatus);
export const useSyncAccount = (): { account: Account | null; signedIn: boolean } => {
  useSyncExternalStore(subscribe, () => `${signedIn}:${account?.email}:${account?.entitled}`);
  return { account, signedIn };
};

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
  console.error('[sync]', error);
  return { code: 'failed', message: 'Syncing didn’t work. It will try again.' };
}

function makeEngine(key: Uint8Array): SyncEngine {
  return new SyncEngine({
    api: remoteApi,
    codec: mobileCodec(key),
    stores: [chatKind(chatStorage), memoryKind(memoryStorage)],
    tracking: trackingStore,
    newId: () => `${Date.now()}-${randomUUID().slice(0, 9)}`,
    // Encrypting hundreds of chats on the first sync must not freeze the screen.
    yieldToUi: () => new Promise<void>(resolve => setTimeout(resolve, 0)),
  });
}

function schedule(delay: number) {
  clearTimeout(timer);
  timer = setTimeout(() => void syncNow(), delay);
}

function markChanged(kind: 'chat' | 'memory', changes: { id: string; deleted: boolean }[]) {
  const active = engine;
  if (!active) return;
  pendingMarks = pendingMarks.then(async () => {
    for (const change of changes) await active.markChanged(kind, change.id, change.deleted);
  }).then(() => schedule(AFTER_CHANGE_MS), () => {});
}

/** Syncs now (soon, if a reply is being written). Safe to call at any time. */
export async function syncNow({ manual = false } = {}): Promise<void> {
  if (!engine) return;
  if (manual) blocked = false;
  if (blocked) return;
  if (AppState.currentState !== 'active') return; // runs when the app comes back
  const chats = getChatBridge();
  if (!chats || chats.busy()) return schedule(3_000);
  if (running) {
    rerun = true;
    return running;
  }
  const active = engine;
  setStatus({ phase: 'syncing', error: null });
  running = (async () => {
    try {
      await pendingMarks;
      await chats.flush(); // edits waiting to be saved are announced when they are...
      await pendingMarks; // ...and written down before anything is merged
      await memoryService.initialize();
      const report = await active.run();
      lastRunAt = Date.now();
      if (settings) {
        settings = { ...settings, lastSyncAt: lastRunAt };
        await saveSettings(settings);
      }
      setStatus({ phase: 'idle', lastSyncAt: lastRunAt, error: null, skipped: report.skipped, tooLarge: report.tooLarge });
    } catch (error) {
      if (error instanceof ConcurrentEditError || error instanceof NotReadyError) {
        // A chat changed under it, or chats aren't loaded yet. Nothing is wrong: go again in a moment.
        setStatus({ phase: 'idle' });
        schedule(2_000);
        return;
      }
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

/** Loads sync from this phone's saved setup and starts the background syncing. */
export async function initSync(): Promise<void> {
  if (started) return;
  started = true;

  onConversationChanges(changes => markChanged('chat', changes));
  memoryService.onChanges(changes => markChanged('memory', changes));
  const wake = () => {
    if (engine && Date.now() - lastRunAt > MIN_GAP_MS) void syncNow();
  };
  AppState.addEventListener('change', state => state === 'active' && wake());
  setInterval(wake, REGULAR_MS);

  signedIn = Boolean(await getToken());
  const saved = await loadSetup().catch(() => null);
  if (!saved) return emit();
  engine = makeEngine(saved.key);
  settings = saved.settings;
  setStatus({ phase: 'idle', email: saved.settings.email, lastSyncAt: saved.settings.lastSyncAt });
  void refreshAccount();
  schedule(2_500);
}

// ---------- sign-in ----------

export async function refreshAccount(): Promise<Account | null> {
  try {
    const me = await api<{ user: { email: string } | null; sync: boolean }>('me');
    signedIn = Boolean(me.user) && Boolean(await getToken());
    account = me.user ? { email: me.user.email, entitled: me.sync } : null;
    if (!me.user && (await getToken())) {
      await clearToken(); // the token no longer works
      signedIn = false;
    }
  } catch {
    // Offline: keep what we have.
  }
  emit();
  return account;
}

export const startSignIn = (email: string): Promise<{ devCode?: string }> => api('auth/start', { body: { email } });

export async function verifySignIn(email: string, code: string): Promise<void> {
  const result = await api<{ token: string }>('auth/verify', { body: { email, code, client: 'app' } });
  await saveToken(result.token);
  signedIn = true;
  blocked = false;
  await refreshAccount();
  if (engine && status.phase === 'error') setStatus({ phase: 'idle', error: null });
}

/** Signs out of the account. Sync stays set up on this phone and resumes when you sign in again. */
export async function signOut(): Promise<void> {
  await clearToken();
  signedIn = false;
  account = null;
  emit();
}

/**
 * Deletes the Quo account and everything held for it (synced chats and memories,
 * credits, plan records), then signs out and turns sync off here. Chats and
 * memories on this phone stay. The server refuses while a plan is still running.
 */
export async function deleteAccount(): Promise<void> {
  await api('account/delete', { body: { confirm: true } });
  await disableSync();
  await signOut();
}

// ---------- turning it on and off ----------

async function begin(key: Uint8Array, email: string): Promise<void> {
  settings = { email, startedAt: Date.now(), lastSyncAt: null };
  await saveSetup(key, settings);
  engine = makeEngine(key);
  blocked = false;
  setStatus({ ...OFF, phase: 'idle', email });
  await memoryService.initialize();
  await engine.markAllDirty(); // what's already on this phone goes up too
  void syncNow({ manual: true });
}

/** Turns Quo Sync on for this account with a new recovery key (shown to the user first). */
export async function createSync(secret: Uint8Array, email: string): Promise<void> {
  const key = deriveKey(secret);
  await api('sync/setup', { body: { verifier: makeVerifier(key) } });
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
  const key = deriveKey(secret);
  const remote = await remoteApi.status();
  if (!remote.enabled || !remote.verifier) throw new JoinError('not_set_up');
  if (!checkVerifier(key, remote.verifier)) throw new JoinError('wrong_key');
  await begin(key, email);
}

/** Stops syncing on this phone. Chats and memories stay here and in the cloud. */
export async function disableSync(): Promise<void> {
  clearTimeout(timer);
  engine = null;
  settings = null;
  blocked = false;
  rerun = false;
  await clearSetup();
  setStatus({ ...OFF });
}

/** Deletes the cloud copy for good, then turns sync off here. Chats and memories on this phone stay. */
export async function deleteCloudCopy(): Promise<void> {
  await api('sync/reset', { body: {} });
  await disableSync();
}

export function getCloudStatus(): Promise<{ entitled: boolean; enabled: boolean; usedBytes: number; limitBytes: number; records: number }> {
  return api('sync/status');
}
