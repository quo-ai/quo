import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  documentDirectory,
  getInfoAsync,
  deleteAsync,
  makeDirectoryAsync,
  moveAsync,
  readAsStringAsync,
  writeAsStringAsync,
} from 'expo-file-system/legacy';
import { downloadWithValidation } from './fileDownload';
import { Conversation } from '@/types/chat';
import { topKBySimilarity } from '@/utils/vector';
import { analyticsService } from './analyticsService';

// Semantic recall: an optional, premium, on-device embedding index over each
// conversation. When old messages have been folded into the rolling summary,
// recall retrieves the few most relevant originals for the current question
// and injects them verbatim into the prompt — the precision the summary
// can't provide. Uses a tiny embedding model (~84MB, optional download) in
// its own llama context, so it never competes with the chat model's context.
let initLlama: typeof import('llama.rn').initLlama | null = null;
if (Platform.OS !== 'web') {
  try {
    initLlama = require('llama.rn').initLlama;
  } catch {
    // llama.rn unavailable on this platform
  }
}
type LlamaContext = import('llama.rn').LlamaContext;

export const RECALL_MODEL = {
  url: 'https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF/resolve/main/nomic-embed-text-v1.5.Q4_K_M.gguf?download=true',
  filename: 'nomic-embed-text-v1.5.Q4_K_M.gguf',
  sizeBytes: 84106624,
  sizeLabel: '84 MB',
};

const ENABLED_KEY = '@recall_enabled';
// Legacy (v1) storage: one AsyncStorage row per conversation holding float
// vectors as JSON. Too big for Android's 6MB AsyncStorage DB / 2MB
// CursorWindow, so indexes now live in files; this key is only read to migrate.
const LEGACY_INDEX_KEY_PREFIX = 'local_ai_recall_index:';
const INDEX_FILE_VERSION = 2;
// Complete = near the expected size (5% slack); a fixed byte floor let
// truncated downloads pass as valid models (see ttsService).
const MIN_VALID_BYTES = RECALL_MODEL.sizeBytes * 0.95;
// int8 + base64 is ~1KB per 768-dim vector, so ~1.4KB/entry with snippet:
// 1500 entries keeps a conversation's index file around 2MB.
export const MAX_INDEX_ENTRIES = 1500;
const MIN_CONTENT_CHARS = 24;
const MAX_EMBEDS_PER_PASS = 8;
const EMBED_INPUT_CHARS = 1200;
const SNIPPET_CHARS = 280;
const TOP_K = 3;
const MIN_SIMILARITY = 0.45;
// Parsed indexes kept in memory so recall() doesn't re-read a ~2MB file per send.
const INDEX_CACHE_SIZE = 3;

type Role = 'user' | 'assistant';

interface IndexEntry {
  id: string;
  role: Role;
  snippet: string;
  /** Dequantization scale: value[i] = q[i] * scale. */
  scale: number;
  q: Int8Array;
}

interface LoadedIndex {
  entries: IndexEntry[];
  /** Message ids already handled (embedded, too short, or evicted) — never re-embedded. */
  processed: Set<string>;
}

interface StoredEntry {
  id: string;
  role: Role;
  snippet: string;
  s: number;
  q: string; // base64 of int8 bytes
}

interface IndexFile {
  version: number;
  entries: StoredEntry[];
  processed: string[];
}

interface LegacyEntry {
  id: string;
  role: Role;
  snippet: string;
  v: number[];
}

/** Symmetric int8 quantization with a per-vector scale. */
export function quantizeVector(vector: ArrayLike<number>): { scale: number; q: Int8Array } {
  let maxAbs = 0;
  for (let i = 0; i < vector.length; i++) {
    const a = Math.abs(vector[i]);
    if (a > maxAbs) maxAbs = a;
  }
  const q = new Int8Array(vector.length);
  if (maxAbs === 0 || !Number.isFinite(maxAbs)) return { scale: 0, q };
  const scale = maxAbs / 127;
  for (let i = 0; i < vector.length; i++) {
    q[i] = Math.max(-127, Math.min(127, Math.round(vector[i] / scale)));
  }
  return { scale, q };
}

export function dequantizeVector(q: Int8Array, scale: number): number[] {
  const out = new Array<number>(q.length);
  for (let i = 0; i < q.length; i++) out[i] = q[i] * scale;
  return out;
}

export function encodeInt8(q: Int8Array): string {
  let binary = '';
  const CHUNK = 0x2000;
  for (let i = 0; i < q.length; i += CHUNK) {
    const end = Math.min(i + CHUNK, q.length);
    const codes = new Array<number>(end - i);
    for (let j = i; j < end; j++) codes[j - i] = q[j] & 0xff;
    binary += String.fromCharCode(...codes);
  }
  return btoa(binary);
}

export function decodeInt8(base64: string): Int8Array {
  const binary = atob(base64);
  const q = new Int8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    const c = binary.charCodeAt(i);
    q[i] = c > 127 ? c - 256 : c;
  }
  return q;
}

/**
 * Deliberate index eviction. Entries whose message no longer exists are
 * dropped first; if still over the cap, entries are thinned evenly across the
 * conversation's history (rather than dropping the oldest block, which is
 * exactly the summarized-away content recall exists for). Kept entries are
 * returned in conversation order.
 */
export function evictIndexEntries<T extends { id: string }>(
  entries: T[],
  liveMessageIds: string[],
  cap: number,
): { kept: T[]; evicted: string[] } {
  const position = new Map<string, number>();
  liveMessageIds.forEach((id, i) => position.set(id, i));

  const evicted: string[] = [];
  const seen = new Set<string>();
  const live: T[] = [];
  for (const entry of entries) {
    if (!position.has(entry.id) || seen.has(entry.id)) {
      evicted.push(entry.id);
      continue;
    }
    seen.add(entry.id);
    live.push(entry);
  }
  live.sort((a, b) => position.get(a.id)! - position.get(b.id)!);

  const n = live.length;
  const limit = Math.max(0, cap);
  if (n <= limit) return { kept: live, evicted };

  // Remove `excess` entries at evenly spaced positions. Since n > excess the
  // stride is >= 1, so the floor()ed indices are strictly increasing (distinct).
  const excess = n - limit;
  const drop = new Set<number>();
  for (let j = 0; j < excess; j++) {
    drop.add(Math.min(n - 1, Math.floor(((j + 0.5) * n) / excess)));
  }
  const kept: T[] = [];
  live.forEach((entry, i) => {
    if (drop.has(i)) evicted.push(entry.id);
    else kept.push(entry);
  });
  return { kept, evicted };
}

function fromLegacyEntries(legacy: LegacyEntry[]): LoadedIndex {
  const entries: IndexEntry[] = [];
  const processed = new Set<string>();
  for (const e of legacy) {
    if (!e || typeof e.id !== 'string' || !Array.isArray(e.v)) continue;
    const { scale, q } = quantizeVector(e.v);
    entries.push({ id: e.id, role: e.role, snippet: e.snippet, scale, q });
    processed.add(e.id);
  }
  return { entries, processed };
}

function fromFile(file: IndexFile): LoadedIndex {
  const entries: IndexEntry[] = [];
  for (const e of file.entries ?? []) {
    try {
      entries.push({ id: e.id, role: e.role, snippet: e.snippet, scale: e.s, q: decodeInt8(e.q) });
    } catch {
      // Skip a corrupt entry rather than losing the whole index
    }
  }
  return { entries, processed: new Set(file.processed ?? entries.map(e => e.id)) };
}

function toFile(index: LoadedIndex): IndexFile {
  return {
    version: INDEX_FILE_VERSION,
    entries: index.entries.map(e => ({
      id: e.id,
      role: e.role,
      snippet: e.snippet,
      s: e.scale,
      q: encodeInt8(e.q),
    })),
    processed: Array.from(index.processed),
  };
}

function cleanContent(content: string): string {
  return content
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/\[THINK\][\s\S]*?\[\/THINK\]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

class RecallService {
  private static instance: RecallService;
  private context: LlamaContext | null = null;
  private loadingPromise: Promise<boolean> | null = null;
  private enabledCache: boolean | null = null;
  private indexing = false;
  private activeEmbeds = 0;
  /** LRU of parsed indexes (Map iteration order = recency, oldest first). */
  private indexCache = new Map<string, LoadedIndex>();
  /** Bumped by deletes so an in-flight indexing pass can't resurrect a deleted index. */
  private deleteEpoch = 0;

  static getInstance(): RecallService {
    if (!RecallService.instance) {
      RecallService.instance = new RecallService();
    }
    return RecallService.instance;
  }

  private legacyIndexKey(conversationId: string): string {
    return `${LEGACY_INDEX_KEY_PREFIX}${conversationId}`;
  }

  private indexDir(): string {
    return `${documentDirectory}recall/`;
  }

  private indexPath(conversationId: string): string {
    // Keep file URIs free of characters that need percent-encoding.
    return `${this.indexDir()}${conversationId.replace(/[^A-Za-z0-9_-]/g, '_')}.json`;
  }

  private modelPath(): string {
    return `${documentDirectory}models/${RECALL_MODEL.filename}`;
  }

  async isEnabled(): Promise<boolean> {
    if (this.enabledCache !== null) return this.enabledCache;
    try {
      this.enabledCache = (await AsyncStorage.getItem(ENABLED_KEY)) === 'true';
    } catch {
      this.enabledCache = false;
    }
    return this.enabledCache;
  }

  async setEnabled(enabled: boolean): Promise<void> {
    this.enabledCache = enabled;
    await AsyncStorage.setItem(ENABLED_KEY, String(enabled)).catch(() => {});
    void analyticsService.track('recall_toggled', { enabled });
    if (!enabled) {
      await this.release();
    }
  }

  async isModelDownloaded(): Promise<boolean> {
    if (Platform.OS === 'web') return false;
    try {
      const info = await getInfoAsync(this.modelPath());
      return info.exists && 'size' in info && info.size >= MIN_VALID_BYTES;
    } catch {
      return false;
    }
  }

  async downloadModel(onProgress?: (progress: number) => void): Promise<boolean> {
    if (Platform.OS === 'web') return false;
    try {
      if (await this.isModelDownloaded()) {
        onProgress?.(100);
        return true;
      }

      void analyticsService.track('recall_download_started', {});
      const ok = await downloadWithValidation({
        url: RECALL_MODEL.url,
        destPath: this.modelPath(),
        expectedBytes: RECALL_MODEL.sizeBytes,
        minValidBytes: MIN_VALID_BYTES,
        onProgress,
      });
      if (ok) {
        onProgress?.(100);
        void analyticsService.track('recall_download_completed', {});
      } else {
        void analyticsService.track('recall_download_failed', { error: 'verification_failed' });
      }
      return ok;
    } catch (error) {
      void analyticsService.track('recall_download_failed', {
        error: String(error instanceof Error ? error.message : error).slice(0, 100),
      });
      return false;
    }
  }

  async deleteModel(): Promise<void> {
    await this.setEnabled(false);
    await deleteAsync(this.modelPath(), { idempotent: true }).catch(() => {});
  }

  private async ensureContext(): Promise<boolean> {
    if (this.context) return true;
    if (this.loadingPromise) return this.loadingPromise;
    if (!initLlama || !(await this.isModelDownloaded())) return false;

    this.loadingPromise = (async () => {
      try {
        this.context = await initLlama!({
          model: this.modelPath(),
          embedding: true,
          n_ctx: 512,
          n_batch: 512,
          n_threads: 2,
          n_gpu_layers: 0,
          use_mmap: true,
          use_mlock: false,
        });
        return true;
      } catch {
        this.context = null;
        return false;
      } finally {
        this.loadingPromise = null;
      }
    })();
    return this.loadingPromise;
  }

  private async embed(text: string, kind: 'document' | 'query'): Promise<number[] | null> {
    if (!(await this.ensureContext())) return null;
    this.activeEmbeds++;
    try {
      // nomic-embed models are trained with task prefixes.
      const result = await this.context!.embedding(`search_${kind}: ${text.slice(0, EMBED_INPUT_CHARS)}`);
      const vector = result?.embedding;
      return Array.isArray(vector) && vector.length > 0 ? vector : null;
    } catch {
      return null;
    } finally {
      this.activeEmbeds--;
    }
  }

  /** True while indexing or an embedding call is in flight. */
  isBusy(): boolean {
    return this.indexing || this.activeEmbeds > 0;
  }

  private cacheGet(conversationId: string): LoadedIndex | undefined {
    const hit = this.indexCache.get(conversationId);
    if (hit) {
      this.indexCache.delete(conversationId);
      this.indexCache.set(conversationId, hit);
    }
    return hit;
  }

  private cacheSet(conversationId: string, index: LoadedIndex): void {
    this.indexCache.delete(conversationId);
    this.indexCache.set(conversationId, index);
    while (this.indexCache.size > INDEX_CACHE_SIZE) {
      const oldest = this.indexCache.keys().next().value;
      if (oldest === undefined) break;
      this.indexCache.delete(oldest);
    }
  }

  private async readIndexFile(path: string): Promise<LoadedIndex | null> {
    const info = await getInfoAsync(path);
    if (!info.exists) return null;
    const parsed = JSON.parse(await readAsStringAsync(path)) as IndexFile;
    if (!parsed || parsed.version !== INDEX_FILE_VERSION || !Array.isArray(parsed.entries)) {
      return null;
    }
    return fromFile(parsed);
  }

  private async loadIndex(conversationId: string): Promise<LoadedIndex> {
    const cached = this.cacheGet(conversationId);
    if (cached) return cached;

    const path = this.indexPath(conversationId);
    let index: LoadedIndex | null = null;
    try {
      index = await this.readIndexFile(path);
    } catch {
      index = null;
    }
    if (!index) {
      // A crash between delete+move (iOS can't move onto an existing file)
      // can leave only the .tmp behind.
      try {
        index = await this.readIndexFile(`${path}.tmp`);
      } catch {
        index = null;
      }
    }
    if (!index) {
      index = await this.migrateLegacyIndex(conversationId);
    }
    const result = index ?? { entries: [], processed: new Set<string>() };
    this.cacheSet(conversationId, result);
    return result;
  }

  /** One-time move of a v1 AsyncStorage index into the file store. */
  private async migrateLegacyIndex(conversationId: string): Promise<LoadedIndex | null> {
    const key = this.legacyIndexKey(conversationId);
    let raw: string | null = null;
    try {
      raw = await AsyncStorage.getItem(key);
    } catch {
      // Row is likely over the CursorWindow limit: unreadable forever, so
      // free the space. The index is derived data and is rebuilt by
      // indexConversation.
      await AsyncStorage.removeItem(key).catch(() => {});
      return null;
    }
    if (!raw) return null;

    let index: LoadedIndex;
    try {
      const legacy = JSON.parse(raw) as LegacyEntry[];
      index = fromLegacyEntries(Array.isArray(legacy) ? legacy : []);
    } catch {
      await AsyncStorage.removeItem(key).catch(() => {});
      return null;
    }
    // Only drop the old row once the file is safely written.
    if (await this.writeIndexFile(conversationId, index)) {
      await AsyncStorage.removeItem(key).catch(() => {});
    }
    return index;
  }

  /** Atomic-ish write: tmp file, then move into place. Returns success. */
  private async writeIndexFile(conversationId: string, index: LoadedIndex): Promise<boolean> {
    const path = this.indexPath(conversationId);
    const tmpPath = `${path}.tmp`;
    try {
      await makeDirectoryAsync(this.indexDir(), { intermediates: true }).catch(() => {});
      await writeAsStringAsync(tmpPath, JSON.stringify(toFile(index)));
      try {
        await moveAsync({ from: tmpPath, to: path });
      } catch {
        // iOS refuses to move onto an existing file.
        await deleteAsync(path, { idempotent: true });
        await moveAsync({ from: tmpPath, to: path });
      }
      return true;
    } catch {
      return false; // Index persistence is best-effort
    }
  }

  /**
   * Embed any not-yet-indexed messages of the conversation. Designed for
   * idle time: bounded work per pass, separate context, all errors soft.
   */
  async indexConversation(conversation: Conversation): Promise<void> {
    if (this.indexing) return;
    if (!(await this.isEnabled()) || !(await this.isModelDownloaded())) return;

    this.indexing = true;
    const epoch = this.deleteEpoch;
    try {
      const loaded = await this.loadIndex(conversation.id);
      const entries = [...loaded.entries];
      const processed = new Set(loaded.processed);
      let changed = false;

      // Bound the processed set to messages that still exist.
      const liveIds = conversation.messages.map(m => m.id);
      const liveSet = new Set(liveIds);
      for (const id of processed) {
        if (!liveSet.has(id)) {
          processed.delete(id);
          changed = true;
        }
      }

      let added = 0;
      // Newest first: recent messages are the ones about to be summarized
      // away, and a backlog of old ones must not starve them.
      for (let i = conversation.messages.length - 1; i >= 0; i--) {
        if (added >= MAX_EMBEDS_PER_PASS) break;
        const message = conversation.messages[i];
        if (processed.has(message.id)) continue;

        const content = cleanContent(message.content);
        if (content.length < MIN_CONTENT_CHARS) {
          processed.add(message.id);
          changed = true;
          continue;
        }

        const vector = await this.embed(content, 'document');
        if (!vector) break; // context unavailable — retry next idle pass
        if (this.deleteEpoch !== epoch) return;

        const { scale, q } = quantizeVector(vector);
        entries.push({
          id: message.id,
          role: message.role,
          snippet: content.slice(0, SNIPPET_CHARS),
          scale,
          q,
        });
        processed.add(message.id);
        added++;
        changed = true;
      }

      const { kept, evicted } = evictIndexEntries(entries, liveIds, MAX_INDEX_ENTRIES);
      if (kept.length !== entries.length) changed = true;
      // Evicted ids stay processed so they're not re-embedded (ids of
      // deleted messages were already pruned above).
      for (const id of evicted) {
        if (liveSet.has(id)) processed.add(id);
      }

      if (!changed || this.deleteEpoch !== epoch) return;
      const next: LoadedIndex = { entries: kept, processed };
      this.cacheSet(conversation.id, next);
      await this.writeIndexFile(conversation.id, next);
    } finally {
      this.indexing = false;
    }
  }

  /**
   * Retrieve the most relevant summarized-away messages for the query.
   * Only messages the LLM can no longer see (index < coveredCount) are
   * candidates. Returns formatted lines for prompt injection, or null.
   */
  async recall(conversation: Conversation, query: string, coveredCount: number): Promise<string | null> {
    if (coveredCount <= 0) return null;
    if (!(await this.isEnabled()) || !(await this.isModelDownloaded())) return null;

    const coveredIds = new Set(conversation.messages.slice(0, coveredCount).map(m => m.id));
    const covered = (await this.loadIndex(conversation.id)).entries.filter(e => coveredIds.has(e.id));
    if (covered.length === 0) return null;

    const queryVector = await this.embed(query, 'query');
    if (!queryVector) return null;

    const candidates = covered.map(e => ({
      role: e.role,
      snippet: e.snippet,
      v: dequantizeVector(e.q, e.scale),
    }));
    const matches = topKBySimilarity(queryVector, candidates, TOP_K, MIN_SIMILARITY);
    if (matches.length === 0) return null;

    void analyticsService.track('recall_used', {
      candidates: candidates.length,
      matches: matches.length,
      top_score: Math.round(matches[0].score * 100) / 100,
    });

    return matches
      .map(m => `${m.role === 'user' ? 'User' : 'Assistant'} said earlier: "${m.snippet}"`)
      .join('\n');
  }

  async deleteIndex(conversationId: string): Promise<void> {
    this.deleteEpoch++;
    this.indexCache.delete(conversationId);
    const path = this.indexPath(conversationId);
    await Promise.all([
      deleteAsync(path, { idempotent: true }).catch(() => {}),
      deleteAsync(`${path}.tmp`, { idempotent: true }).catch(() => {}),
      AsyncStorage.removeItem(this.legacyIndexKey(conversationId)).catch(() => {}),
    ]);
  }

  async clearAllIndexes(): Promise<void> {
    this.deleteEpoch++;
    this.indexCache.clear();
    await deleteAsync(this.indexDir(), { idempotent: true }).catch(() => {});
    try {
      const keys = await AsyncStorage.getAllKeys();
      const legacyKeys = keys.filter(k => k.startsWith(LEGACY_INDEX_KEY_PREFIX));
      if (legacyKeys.length > 0) {
        await AsyncStorage.multiRemove(legacyKeys);
      }
    } catch {
      // Best-effort cleanup
    }
  }

  async release(): Promise<void> {
    if (this.context) {
      await this.context.release().catch(() => {});
      this.context = null;
    }
  }
}

export const recallService = RecallService.getInstance();
