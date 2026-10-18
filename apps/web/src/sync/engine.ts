import type { Conversation } from '../chat/types';
import { checkVerifier, decryptRecord, encryptRecord, SyncCryptoError } from './crypto';
import { prepareForSync, reconcile, withLocalAttachments } from './merge';

/**
 * Brings this device's chats and the encrypted copy on the server into
 * agreement: pull what changed elsewhere, merge, then push what changed here.
 * It talks to the server, the chat database and its own bookkeeping through
 * small interfaces, so the whole thing runs the same in tests as in the app.
 */

export const KIND = 'chat';
const MAX_BATCH_RECORDS = 25;
const MAX_BATCH_CHARS = 3_000_000;
const MAX_BLOB_CHARS = 1_400_000;
const MAX_ROUNDS = 5;

export interface RemoteRecord {
  id: string;
  kind: string;
  seq: number;
  blob: string | null;
  deleted: boolean;
}

export interface PushRecord {
  id: string;
  kind: string;
  blob: string | null;
  deleted: boolean;
  baseSeq: number;
}

export interface SyncApi {
  status(): Promise<{ enabled: boolean; verifier: string | null }>;
  pull(since: number): Promise<{ records: RemoteRecord[]; seq: number; more: boolean }>;
  push(records: PushRecord[]): Promise<{ seq: number; accepted: { id: string; seq: number }[]; conflicts: string[] }>;
}

export interface LocalChats {
  get(id: string): Promise<Conversation | undefined>;
  /** Writes a chat that came from sync (this must not count as a local edit). */
  put(conversation: Conversation): Promise<void>;
  remove(id: string): Promise<void>;
  all(): Promise<Conversation[]>;
}

/** What this device knows about each chat's state on the server. */
export interface Tracked {
  id: string;
  /** The server's change number for the version this device last saw. */
  seq: number;
  /** Counts local edits, so an edit made during an upload isn't lost. */
  rev: number;
  /** Changed here since it was last uploaded. */
  dirty: boolean;
  deleted: boolean;
  /** Too big to sync; skipped until it changes. */
  tooLarge?: boolean;
}

export interface TrackingStore {
  get(id: string): Promise<Tracked | undefined>;
  put(record: Tracked): Promise<void>;
  remove(id: string): Promise<void>;
  dirty(): Promise<Tracked[]>;
  getSeq(): Promise<number>;
  setSeq(seq: number): Promise<void>;
}

/** The server's copy was deleted, or its recovery key changed, since this device last synced. */
export class SyncStateError extends Error {
  constructor(public code: 'cloud_reset' | 'key_changed') {
    super(code);
  }
}

export interface SyncReport {
  pulled: number;
  pushed: number;
  /** This device's chats changed because of what was pulled. */
  changed: boolean;
  /** Records that couldn't be read (damaged, or from a different key). */
  skipped: number;
  tooLarge: number;
}

interface Dependencies {
  api: SyncApi;
  chats: LocalChats;
  tracking: TrackingStore;
  key: CryptoKey;
  newId?: () => string;
}

const fresh = (id: string): Tracked => ({ id, seq: 0, rev: 0, dirty: false, deleted: false });

export class SyncEngine {
  private newId: () => string;

  constructor(private deps: Dependencies) {
    this.newId = deps.newId ?? (() => crypto.randomUUID());
  }

  /** Call when a chat is saved or deleted on this device. */
  async markChanged(id: string, deleted: boolean): Promise<void> {
    const record = (await this.deps.tracking.get(id)) ?? fresh(id);
    await this.deps.tracking.put({ ...record, rev: record.rev + 1, dirty: true, deleted, tooLarge: false });
  }

  /** First sync on this device: everything here needs uploading. */
  async markAllDirty(): Promise<void> {
    for (const chat of await this.deps.chats.all()) await this.markChanged(chat.id, false);
  }

  async run(): Promise<SyncReport> {
    await this.checkAccount();
    const report: SyncReport = { pulled: 0, pushed: 0, changed: false, skipped: 0, tooLarge: 0 };
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const pulled = await this.pull();
      report.pulled += pulled.applied;
      report.skipped += pulled.skipped;
      report.changed ||= pulled.changed;
      const pushed = await this.push();
      report.pushed += pushed.pushed;
      report.tooLarge = pushed.tooLarge;
      if (pushed.conflicts === 0) break; // otherwise something changed elsewhere meanwhile: pull and merge again
    }
    return report;
  }

  /** Is the server's copy still the one this device's key belongs to? */
  private async checkAccount(): Promise<void> {
    const status = await this.deps.api.status();
    if (!status.enabled || !status.verifier) throw new SyncStateError('cloud_reset');
    if (!(await checkVerifier(this.deps.key, status.verifier))) throw new SyncStateError('key_changed');
  }

  private async pull(): Promise<{ applied: number; skipped: number; changed: boolean }> {
    const { api, tracking } = this.deps;
    let since = await tracking.getSeq();
    const totals = { applied: 0, skipped: 0, changed: false };
    for (;;) {
      const page = await api.pull(since);
      for (const record of page.records) {
        const outcome = await this.applyRemote(record);
        if (outcome === 'skipped') totals.skipped++;
        else if (outcome === 'applied') totals.applied++;
        if (outcome === 'applied') totals.changed = true;
      }
      since = Math.max(since, page.seq);
      await tracking.setSeq(since);
      if (!page.more) return totals;
    }
  }

  private async applyRemote(record: RemoteRecord): Promise<'applied' | 'ignored' | 'skipped'> {
    const { chats, tracking, key } = this.deps;
    const tracked = (await tracking.get(record.id)) ?? fresh(record.id);
    if (record.seq <= tracked.seq) return 'ignored'; // already have this version

    if (record.deleted) {
      if (tracked.dirty && !tracked.deleted) {
        // Deleted elsewhere but changed here since: keep it, and it goes back up.
        await tracking.put({ ...tracked, seq: record.seq });
        return 'ignored';
      }
      const existed = Boolean(await chats.get(record.id));
      await chats.remove(record.id);
      await tracking.put({ ...tracked, seq: record.seq, dirty: false, deleted: true });
      return existed ? 'applied' : 'ignored';
    }

    let remote: Conversation;
    try {
      remote = await decryptRecord<Conversation>(key, KIND, record.id, record.blob ?? '');
    } catch (error) {
      if (!(error instanceof SyncCryptoError)) throw error;
      return 'skipped';
    }
    if (remote?.id !== record.id || !Array.isArray(remote.messages)) return 'skipped';

    const local = await chats.get(record.id);
    if (!local || !tracked.dirty) {
      // Nothing here that the server hasn't seen: take its version.
      await chats.put(local ? withLocalAttachments(remote, local) : remote);
      await tracking.put({ ...tracked, seq: record.seq, dirty: false, deleted: false });
      return 'applied';
    }

    const merged = reconcile(local, remote, this.newId);
    await chats.put(merged.conversation);
    await tracking.put({ ...tracked, seq: record.seq, deleted: false, dirty: merged.pushNeeded, rev: tracked.rev + (merged.pushNeeded ? 1 : 0) });
    if (merged.copy) {
      await chats.put(merged.copy);
      await this.markChanged(merged.copy.id, false);
    }
    return 'applied';
  }

  private async push(): Promise<{ pushed: number; conflicts: number; tooLarge: number }> {
    const { api, chats, tracking, key } = this.deps;
    const entries: { rev: number; payload: PushRecord }[] = [];
    let tooLarge = 0;

    for (const record of await tracking.dirty()) {
      const chat = record.deleted ? undefined : await chats.get(record.id);
      if (!chat) {
        // Deleted here. If the server never had it there's nothing to tell it.
        if (record.seq === 0) await tracking.remove(record.id);
        else entries.push({ rev: record.rev, payload: { id: record.id, kind: KIND, blob: null, deleted: true, baseSeq: record.seq } });
        continue;
      }
      const blob = await encryptRecord(key, KIND, record.id, prepareForSync(chat));
      if (blob.length > MAX_BLOB_CHARS) {
        await tracking.put({ ...record, dirty: false, tooLarge: true });
        tooLarge++;
        continue;
      }
      entries.push({ rev: record.rev, payload: { id: record.id, kind: KIND, blob, deleted: false, baseSeq: record.seq } });
    }

    let pushed = 0;
    let conflicts = 0;
    for (let start = 0; start < entries.length;) {
      let end = start;
      let chars = 0;
      while (end < entries.length && end - start < MAX_BATCH_RECORDS && (end === start || chars + (entries[end].payload.blob?.length ?? 0) <= MAX_BATCH_CHARS)) {
        chars += entries[end].payload.blob?.length ?? 0;
        end++;
      }
      const batch = entries.slice(start, end);
      start = end;

      const result = await api.push(batch.map(entry => entry.payload));
      conflicts += result.conflicts.length;
      for (const { id, seq } of result.accepted) {
        const sent = batch.find(entry => entry.payload.id === id)!;
        const latest = (await tracking.get(id)) ?? fresh(id);
        // If it was edited again while uploading, it stays dirty, now based on the new version.
        await tracking.put({ ...latest, seq, dirty: latest.rev !== sent.rev, deleted: sent.payload.deleted, tooLarge: false });
        pushed++;
      }
    }
    return { pushed, conflicts, tooLarge };
  }
}
