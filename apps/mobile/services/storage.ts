import AsyncStorage from '@react-native-async-storage/async-storage';
import { Conversation, AppSettings, Message } from '@/types/chat';
import { getDefaultModel, DEFAULT_MODEL_ID } from '@/constants/models';
import { analyticsService } from './analyticsService';
import { repairAssistantContent } from '@/utils/repairMessage';
import { chatFingerprint } from '@/services/sync/convert';

// Conversations are stored one-per-key. A single blob for the whole history
// hits Android's ~2MB CursorWindow row limit once a user accumulates enough
// messages, which makes the entire history unreadable in one shot. Per-row
// storage caps the blast radius at one conversation and lets saves skip
// unchanged rows.
const LEGACY_CONVERSATIONS_KEY = 'local_ai_conversations';
const CONVERSATION_INDEX_KEY = 'local_ai_conversation_index';
const CONVERSATION_KEY_PREFIX = 'local_ai_conversation:';
const SETTINGS_KEY = 'local_ai_settings';

const defaultModel = getDefaultModel();

export const defaultSettings: AppSettings = {
  modelId: DEFAULT_MODEL_ID,
  modelName: defaultModel.name,
  temperature: defaultModel.recommendedSettings.temperature,
  maxTokens: defaultModel.recommendedSettings.maxTokens,
  darkMode: true,
};

function conversationKey(id: string): string {
  return `${CONVERSATION_KEY_PREFIX}${id}`;
}

// Fingerprints of what is already on disk this session, so the debounced
// save skips conversations that have not changed.
const savedFingerprints = new Map<string, string>();
let savedIndexJson = '';

// The index may only be rewritten from in-memory state once the history has
// been read successfully. A failed load leaves the app with an empty list;
// writing *that* as the index would orphan every stored row forever.
let loadSucceeded = false;
// Ids listed in the index whose rows could not be read (oversized for the
// Android CursorWindow, corrupt JSON). They stay in the index so a later fix
// or a smaller row can still be recovered, and are never deleted implicitly.
const unreadableIds = new Set<string>();
// Set when the legacy blob was migrated but its rows failed to persist; the
// legacy key is only removed after a later save succeeds.
let legacyRemovalPending = false;

// Quo Sync listens for chats the user saved or deleted (never ones sync itself
// wrote, and never the free tier's trimming of old chats). `notified` remembers
// the last state sync was told about, so changes that don't alter the chat as
// synced (a rewritten long-chat summary) aren't announced; `syncApplied`
// marks what sync just wrote, so it isn't announced back to it.
export interface ConversationChange {
  id: string;
  deleted: boolean;
}
type ChangeListener = (changes: ConversationChange[]) => void;
const changeListeners = new Set<ChangeListener>();
const notified = new Map<string, string>();
const syncApplied = new Map<string, string>();

export function onConversationChanges(listener: ChangeListener): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

function announce(changes: ConversationChange[]): void {
  if (changes.length === 0) return;
  for (const listener of changeListeners) {
    try {
      listener(changes);
    } catch (error) {
      analyticsService.recordError(error, 'storage_change_listener');
    }
  }
}

/** Sync wrote this chat itself: don't announce it as an edit when it's saved. */
export function markSyncApplied(conversation: Conversation): void {
  syncApplied.set(conversation.id, chatFingerprint(conversation));
}

function fingerprint(conversation: Conversation): string {
  return `${conversation.updatedAt}:${conversation.messages.length}:${conversation.contextSummary?.updatedAt ?? 0}`;
}

/** Test-only: reset the in-memory save cache. */
export function __resetStorageCacheForTests(): void {
  savedFingerprints.clear();
  savedIndexJson = '';
  loadSucceeded = false;
  unreadableIds.clear();
  legacyRemovalPending = false;
  notified.clear();
  syncApplied.clear();
  changeListeners.clear();
}

function parseIndex(indexJson: string): string[] {
  const parsed: unknown = JSON.parse(indexJson);
  if (!Array.isArray(parsed)) throw new Error('Conversation index is not an array');
  return parsed.filter((id): id is string => typeof id === 'string');
}

/**
 * Read rows for the given ids. multiGet fails as a whole when any single row
 * is too large for Android's ~2MB CursorWindow, so on failure fall back to
 * per-key reads and skip only the rows that cannot be read.
 */
async function readRows(ids: string[]): Promise<[string, string | null][]> {
  try {
    const entries = await AsyncStorage.multiGet(ids.map(conversationKey));
    return entries.map(([, value], i) => [ids[i], value]);
  } catch (error) {
    analyticsService.recordError(error, 'storage_load_conversations_multiget');
    const rows: [string, string | null][] = [];
    for (const id of ids) {
      try {
        rows.push([id, await AsyncStorage.getItem(conversationKey(id))]);
      } catch (rowError) {
        unreadableIds.add(id);
        analyticsService.recordError(rowError, 'storage_load_conversation_row');
      }
    }
    return rows;
  }
}

export async function loadConversations(): Promise<Conversation[]> {
  try {
    const indexJson = await AsyncStorage.getItem(CONVERSATION_INDEX_KEY);
    if (indexJson === null) {
      return await migrateLegacyConversations();
    }

    const ids = parseIndex(indexJson);
    unreadableIds.clear();
    const rows = ids.length > 0 ? await readRows(ids) : [];
    const conversations: Conversation[] = [];
    for (const [id, value] of rows) {
      if (!value) continue;
      try {
        conversations.push(sanitizeConversationForStorage(JSON.parse(value) as Conversation));
      } catch {
        // Skip a corrupt row rather than failing the whole history, but keep
        // its id in the index.
        unreadableIds.add(id);
      }
    }
    conversations.sort((a, b) => b.updatedAt - a.updatedAt);

    // Prime the save cache so the first debounced save skips unchanged rows
    for (const conversation of conversations) {
      savedFingerprints.set(conversation.id, fingerprint(conversation));
      notified.set(conversation.id, chatFingerprint(conversation));
    }
    savedIndexJson = indexJson;
    loadSucceeded = true;

    return conversations;
  } catch (error) {
    // Storage failures risk silent data loss — surface them in Crashlytics.
    // loadSucceeded stays false so saves cannot clobber the on-disk index.
    console.error('Failed to load conversations:', error);
    analyticsService.recordError(error, 'storage_load_conversations');
    return [];
  }
}

// One-time migration from the legacy single-blob format.
async function migrateLegacyConversations(): Promise<Conversation[]> {
  const data = await AsyncStorage.getItem(LEGACY_CONVERSATIONS_KEY);
  // No index and no legacy blob: a genuinely fresh install.
  loadSucceeded = true;
  if (!data) return [];

  const conversations = (JSON.parse(data) as Conversation[])
    .map(sanitizeConversationForStorage)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  // Only drop the legacy blob once its rows are safely written; otherwise a
  // later successful save finishes the job.
  if (await saveConversations(conversations)) {
    await AsyncStorage.removeItem(LEGACY_CONVERSATIONS_KEY);
  } else {
    legacyRemovalPending = true;
  }
  return conversations;
}

function stripImageBase64(image: Message['image']): Message['image'] {
  if (!image?.base64) return image;
  const { base64: _base64, ...safeImage } = image;
  return safeImage;
}

function stripExtractedDocumentText(document: Message['document']): Message['document'] {
  if (!document?.extractedText) return document;
  return { ...document, extractedText: '' };
}

function sanitizeMessageForStorage(message: Message): Message {
  const image = stripImageBase64(message.image);
  const document = stripExtractedDocumentText(message.document);
  // Heals replies corrupted by the old reasoning-streaming bug (and caps any
  // oversized message) on load and save, so a bad row can't crash the UI.
  const content = message.role === 'assistant' ? repairAssistantContent(message.content) : message.content;

  if (image === message.image && document === message.document && content === message.content) {
    return message;
  }

  return { ...message, image, document, content };
}

function sanitizeConversationForStorage(conversation: Conversation): Conversation {
  return {
    ...conversation,
    messages: conversation.messages.map(sanitizeMessageForStorage),
  };
}

// Conversation writes (save / explicit delete / clear) run one at a time so
// an index rewrite can never interleave with another and resurrect or drop
// ids.
let writeQueue: Promise<unknown> = Promise.resolve();
function enqueueWrite<T>(write: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(write, write);
  writeQueue = run.catch(() => {});
  return run;
}

/** Resolves once every conversation write started so far has finished. */
export function whenWritten(): Promise<unknown> {
  return writeQueue;
}

/**
 * Persist the given conversations (changed rows only) and the index. Never
 * deletes rows: conversations missing from the list simply drop out of the
 * index — removing their rows is explicit via deleteConversationRows, so a
 * transiently short list can never destroy history. Returns true on success.
 */
export function saveConversations(conversations: Conversation[]): Promise<boolean> {
  return enqueueWrite(() => saveConversationsNow(conversations));
}

async function saveConversationsNow(conversations: Conversation[]): Promise<boolean> {
  try {
    const sanitized = conversations.map(sanitizeConversationForStorage);
    const ids = sanitized.map(c => c.id);
    const known = new Set(ids);

    const toWrite: [string, string][] = [];
    for (const conversation of sanitized) {
      if (savedFingerprints.get(conversation.id) !== fingerprint(conversation)) {
        toWrite.push([conversationKey(conversation.id), JSON.stringify(conversation)]);
      }
    }

    let indexJson: string | null = null;
    if (loadSucceeded) {
      indexJson = JSON.stringify([...ids, ...[...unreadableIds].filter(id => !known.has(id))]);
    } else {
      // History never loaded this session: merge with whatever index is on
      // disk instead of replacing it. If that cannot be read either, write
      // rows only and leave the index alone.
      indexJson = await mergeWithStoredIndex(ids);
    }
    if (indexJson !== null && indexJson !== savedIndexJson) {
      toWrite.push([CONVERSATION_INDEX_KEY, indexJson]);
    }

    if (toWrite.length > 0) await AsyncStorage.multiSet(toWrite);

    for (const conversation of sanitized) {
      savedFingerprints.set(conversation.id, fingerprint(conversation));
    }
    if (indexJson !== null) savedIndexJson = indexJson;

    const changes: ConversationChange[] = [];
    for (const [key] of toWrite) {
      if (!key.startsWith(CONVERSATION_KEY_PREFIX)) continue;
      const conversation = sanitized.find(c => conversationKey(c.id) === key);
      if (!conversation) continue;
      const state = chatFingerprint(conversation);
      const fromSync = syncApplied.get(conversation.id) === state;
      syncApplied.delete(conversation.id);
      if (notified.get(conversation.id) !== state && !fromSync) changes.push({ id: conversation.id, deleted: false });
      notified.set(conversation.id, state);
    }
    announce(changes);

    if (legacyRemovalPending) {
      legacyRemovalPending = false;
      await AsyncStorage.removeItem(LEGACY_CONVERSATIONS_KEY).catch(() => {
        legacyRemovalPending = true;
      });
    }
    return true;
  } catch (error) {
    console.error('Failed to save conversations:', error);
    analyticsService.recordError(error, 'storage_save_conversations');
    return false;
  }
}

async function mergeWithStoredIndex(ids: string[]): Promise<string | null> {
  try {
    const stored = await AsyncStorage.getItem(CONVERSATION_INDEX_KEY);
    if (stored === null) {
      // An unmigrated legacy blob must keep the index absent so the next
      // launch still runs the migration.
      if (await AsyncStorage.getItem(LEGACY_CONVERSATIONS_KEY)) return null;
      return JSON.stringify(ids);
    }
    const known = new Set(ids);
    return JSON.stringify([...ids, ...parseIndex(stored).filter(id => !known.has(id))]);
  } catch {
    return null;
  }
}

/**
 * Explicitly delete conversation rows (user delete, clear-all, free-tier cap)
 * and drop them from the index.
 */
export function deleteConversationRows(ids: string[], options: DeleteOptions = {}): Promise<boolean> {
  return enqueueWrite(() => deleteConversationRowsNow(ids, options));
}

/** `quiet`: the chats still exist elsewhere (the free tier trimming old ones, or Quo Sync applying a deletion), so Quo Sync isn't told they were deleted. */
export interface DeleteOptions {
  quiet?: boolean;
}

async function deleteConversationRowsNow(ids: string[], options: DeleteOptions): Promise<boolean> {
  if (ids.length === 0) return true;
  const removed = new Set(ids);
  try {
    await AsyncStorage.multiRemove(ids.map(conversationKey));
    for (const id of ids) {
      savedFingerprints.delete(id);
      unreadableIds.delete(id);
      notified.delete(id);
      syncApplied.delete(id);
    }
    if (!options.quiet) announce(ids.map(id => ({ id, deleted: true })));
    if (loadSucceeded && savedIndexJson) {
      const remaining = parseIndex(savedIndexJson).filter(id => !removed.has(id));
      const indexJson = JSON.stringify(remaining);
      if (indexJson !== savedIndexJson) {
        await AsyncStorage.setItem(CONVERSATION_INDEX_KEY, indexJson);
        savedIndexJson = indexJson;
      }
    }
    return true;
  } catch (error) {
    console.error('Failed to delete conversations:', error);
    analyticsService.recordError(error, 'storage_delete_conversations');
    return false;
  }
}

/** Explicitly delete every conversation row and the index (clear all chats). */
export function clearConversationRows(): Promise<boolean> {
  return enqueueWrite(clearConversationRowsNow);
}

async function clearConversationRowsNow(): Promise<boolean> {
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter(
      key => key.startsWith(CONVERSATION_KEY_PREFIX) || key === CONVERSATION_INDEX_KEY,
    );
    const cleared = keys.filter(key => key.startsWith(CONVERSATION_KEY_PREFIX)).map(key => key.slice(CONVERSATION_KEY_PREFIX.length));
    if (keys.length > 0) await AsyncStorage.multiRemove(keys);
    announce(cleared.map(id => ({ id, deleted: true })));
    notified.clear();
    syncApplied.clear();
    savedFingerprints.clear();
    unreadableIds.clear();
    savedIndexJson = '';
    loadSucceeded = true;
    return true;
  } catch (error) {
    console.error('Failed to clear conversations:', error);
    analyticsService.recordError(error, 'storage_clear_conversations');
    return false;
  }
}

export function capConversationsForFreeTier(conversations: Conversation[], maxChatHistory: number): Conversation[] {
  if (conversations.length <= maxChatHistory) {
    return conversations;
  }
  const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
  return sorted.slice(0, maxChatHistory);
}

export async function loadSettings(): Promise<AppSettings> {
  try {
    const data = await AsyncStorage.getItem(SETTINGS_KEY);
    if (data) {
      return { ...defaultSettings, ...JSON.parse(data) };
    }
    return defaultSettings;
  } catch (error) {
    console.error('Failed to load settings:', error);
    return defaultSettings;
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  try {
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (error) {
    console.error('Failed to save settings:', error);
  }
}

export async function clearAllData(): Promise<void> {
  try {
    const indexJson = await AsyncStorage.getItem(CONVERSATION_INDEX_KEY);
    const ids = indexJson ? (JSON.parse(indexJson) as string[]) : [];
    await AsyncStorage.multiRemove([
      LEGACY_CONVERSATIONS_KEY,
      CONVERSATION_INDEX_KEY,
      SETTINGS_KEY,
      ...ids.map(conversationKey),
    ]);
    savedFingerprints.clear();
    savedIndexJson = '';
    unreadableIds.clear();
    legacyRemovalPending = false;
    // Everything is gone, so an empty list is now the truth on disk.
    loadSucceeded = true;
  } catch (error) {
    console.error('Failed to clear data:', error);
  }
}

// Crash-loop guard for model loads. The marker is written (and awaited)
// right before initLlama and cleared once the load returns either way; if
// it is still present at the next launch the process died mid-load (iOS
// jetsam / Android LMK on an oversized model), so bootstrap must not try
// the same model again.
const PENDING_MODEL_LOAD_KEY = 'local_ai_pending_model_load';
// A model the user picked whose download had not finished yet. Lets a
// download that completes after an app restart still become the active
// model, without persisting it as modelId before it ever loaded.
const PENDING_MODEL_SELECTION_KEY = 'local_ai_pending_model_selection';

async function readMarker(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

async function writeMarker(key: string, value: string | null): Promise<void> {
  try {
    if (value === null) await AsyncStorage.removeItem(key);
    else await AsyncStorage.setItem(key, value);
  } catch (error) {
    analyticsService.recordError(error, `storage_marker_${key}`);
  }
}

export const getPendingModelLoad = () => readMarker(PENDING_MODEL_LOAD_KEY);
export const setPendingModelLoad = (modelId: string | null) => writeMarker(PENDING_MODEL_LOAD_KEY, modelId);
export const getPendingModelSelection = () => readMarker(PENDING_MODEL_SELECTION_KEY);
export const setPendingModelSelection = (modelId: string | null) => writeMarker(PENDING_MODEL_SELECTION_KEY, modelId);
