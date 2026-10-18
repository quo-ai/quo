import type { Reconciled } from './merge';

/**
 * Brings this device's data and the encrypted copy on the server into
 * agreement: pull what changed elsewhere, merge, then push what changed here.
 *
 * This file is the same on every platform (apps/web/src/sync/ is the original;
 * apps/mobile/services/sync/ has a copy that scripts/check-shared-sync.js keeps
 * identical). It knows nothing about the platform: the server, the encryption
 * (`Codec`), where each kind of data lives (`KindStore`) and its own bookkeeping
 * (`TrackingStore`) are all handed in, so it runs the same in tests as in an app.
 */

export const MAX_BATCH_RECORDS = 25;
const MAX_BATCH_CHARS = 3_000_000;
export const MAX_BLOB_CHARS = 1_400_000;
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
  pull(since: number, kinds: string[]): Promise<{ records: RemoteRecord[]; seq: number; more: boolean }>;
  push(records: PushRecord[]): Promise<{ seq: number; accepted: { id: string; seq: number }[]; conflicts: string[] }>;
}

/** Thrown by a Codec when a record can't be read: wrong key, damaged data, or moved to another id. */
export class UndecryptableError extends Error {}

export interface Codec {
  encrypt(kind: string, recordId: string, value: unknown): Promise<string>;
  decrypt(kind: string, recordId: string, blob: string): Promise<unknown>;
  /** Is this the right key for the account? (The server stores a verifier made with it.) */
  verify(verifier: string): Promise<boolean>;
}

/** One kind of synced data (chats, memories) and how this platform stores it. */
export interface KindStore<T extends { id: string } = { id: string }> {
  kind: string;
  /** The id this item has on the server. */
  recordId(id: string): string;
  /** The item id behind a server record id, or null if it isn't one of this kind's. */
  itemId(recordId: string): string | null;
  get(id: string): Promise<T | undefined>;
  /** Writes something that came from sync (this must not count as a local edit). */
  put(item: T): Promise<void>;
  remove(id: string): Promise<void>;
  all(): Promise<T[]>;
  /** Checks a decrypted value really is an item with this id; null if not. */
  parse(value: unknown, id: string): T | null;
  reconcile(local: T, remote: T, newId: () => string): Reconciled<T>;
}

/** What this device knows about each record's state on the server. */
export interface Tracked {
  /** The server's id for it. */
  id: string;
  kind?: string;
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
  /** This device's data changed because of what was pulled. */
  changed: boolean;
  /** Records that couldn't be read (damaged, or from a different key). */
  skipped: number;
  tooLarge: number;
}

interface Dependencies {
  api: SyncApi;
  codec: Codec;
  stores: KindStore<any>[];
  tracking: TrackingStore;
  /** A fresh unique id (for the copy kept when two versions of a chat diverge). */
  newId: () => string;
  /** Gives a busy UI thread a turn between records (phones: encrypting hundreds of chats shouldn't freeze the app). */
  yieldToUi?: () => Promise<void>;
}

const fresh = (id: string, kind: string): Tracked => ({ id, kind, seq: 0, rev: 0, dirty: false, deleted: false });

export class SyncEngine {
  private newId: () => string;

  constructor(private deps: Dependencies) {
    this.newId = deps.newId;
  }

  private storeFor(kind: string | undefined) {
    return this.deps.stores.find(store => store.kind === (kind ?? 'chat'));
  }

  private async breathe() {
    await this.deps.yieldToUi?.();
  }

  /** Call when something is saved or deleted on this device. */
  async markChanged(kind: string, id: string, deleted: boolean): Promise<void> {
    const store = this.storeFor(kind);
    if (!store) return;
    const recordId = store.recordId(id);
    const record = (await this.deps.tracking.get(recordId)) ?? fresh(recordId, kind);
    await this.deps.tracking.put({ ...record, kind, rev: record.rev + 1, dirty: true, deleted, tooLarge: false });
  }

  /** First sync on this device: everything here needs uploading. */
  async markAllDirty(): Promise<void> {
    for (const store of this.deps.stores) {
      for (const item of await store.all()) await this.markChanged(store.kind, item.id, false);
    }
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
    if (!(await this.deps.codec.verify(status.verifier))) throw new SyncStateError('key_changed');
  }

  private async pull(): Promise<{ applied: number; skipped: number; changed: boolean }> {
    const { api, tracking, stores } = this.deps;
    const kinds = stores.map(store => store.kind);
    let since = await tracking.getSeq();
    const totals = { applied: 0, skipped: 0, changed: false };
    for (;;) {
      const page = await api.pull(since, kinds);
      for (const record of page.records) {
        const outcome = await this.applyRemote(record);
        if (outcome === 'skipped') totals.skipped++;
        else if (outcome === 'applied') {
          totals.applied++;
          totals.changed = true;
        }
        await this.breathe();
      }
      since = Math.max(since, page.seq);
      await tracking.setSeq(since);
      if (!page.more) return totals;
    }
  }

  private async applyRemote(record: RemoteRecord): Promise<'applied' | 'ignored' | 'skipped'> {
    const { tracking, codec } = this.deps;
    const store = this.storeFor(record.kind);
    const id = store?.itemId(record.id);
    if (!store || !id) return 'ignored'; // a kind this version of the app doesn't know

    const tracked = (await tracking.get(record.id)) ?? fresh(record.id, store.kind);
    if (record.seq <= tracked.seq) return 'ignored'; // already have this version

    if (record.deleted) {
      if (tracked.dirty && !tracked.deleted) {
        // Deleted elsewhere but changed here since: keep it, and it goes back up.
        await tracking.put({ ...tracked, seq: record.seq });
        return 'ignored';
      }
      const existed = Boolean(await store.get(id));
      await store.remove(id);
      await tracking.put({ ...tracked, seq: record.seq, dirty: false, deleted: true });
      return existed ? 'applied' : 'ignored';
    }

    let remote: { id: string } | null;
    try {
      remote = store.parse(await codec.decrypt(store.kind, record.id, record.blob ?? ''), id);
    } catch (error) {
      if (!(error instanceof UndecryptableError)) throw error;
      return 'skipped';
    }
    if (!remote) return 'skipped';

    const local = await store.get(id);
    if (!local || !tracked.dirty) {
      // Nothing here that the server hasn't seen: take its version.
      await store.put(remote);
      await tracking.put({ ...tracked, seq: record.seq, dirty: false, deleted: false });
      return 'applied';
    }

    const merged = store.reconcile(local, remote, this.newId);
    await store.put(merged.item);
    await tracking.put({ ...tracked, seq: record.seq, deleted: false, dirty: merged.pushNeeded, rev: tracked.rev + (merged.pushNeeded ? 1 : 0) });
    if (merged.copy) {
      await store.put(merged.copy);
      await this.markChanged(store.kind, merged.copy.id, false);
    }
    return 'applied';
  }

  private async push(): Promise<{ pushed: number; conflicts: number; tooLarge: number }> {
    const { api, tracking, codec } = this.deps;
    const entries: { rev: number; payload: PushRecord }[] = [];
    let tooLarge = 0;

    for (const record of await tracking.dirty()) {
      const store = this.storeFor(record.kind);
      const id = store?.itemId(record.id);
      if (!store || !id) continue;
      const kind = store.kind;
      const item = record.deleted ? undefined : await store.get(id);
      if (!item) {
        // Deleted here. If the server never had it there's nothing to tell it.
        if (record.seq === 0) await tracking.remove(record.id);
        else entries.push({ rev: record.rev, payload: { id: record.id, kind, blob: null, deleted: true, baseSeq: record.seq } });
        continue;
      }
      const blob = await codec.encrypt(kind, record.id, item);
      await this.breathe();
      if (blob.length > MAX_BLOB_CHARS) {
        await tracking.put({ ...record, dirty: false, tooLarge: true });
        tooLarge++;
        continue;
      }
      entries.push({ rev: record.rev, payload: { id: record.id, kind, blob, deleted: false, baseSeq: record.seq } });
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
        const latest = (await tracking.get(id)) ?? fresh(id, sent.payload.kind);
        // If it was edited again while uploading, it stays dirty, now based on the new version.
        await tracking.put({ ...latest, kind: sent.payload.kind, seq, dirty: latest.rev !== sent.rev, deleted: sent.payload.deleted, tooLarge: false });
        pushed++;
      }
    }
    return { pushed, conflicts, tooLarge };
  }
}
