import { getDb, type Db } from './db.js';
import { config, features, SETUP_MESSAGES } from './env.js';
import { HttpError, json, readJson } from './http.js';
import { identify } from './identity.js';

/**
 * Quo Sync: the server's half. It stores opaque encrypted records for a
 * signed-in subscriber and hands them to their other devices. Everything
 * readable (chat text, titles, timestamps) is inside the ciphertext, which is
 * encrypted on the device with a key that never reaches this server (see
 * src/sync/crypto.ts and SYNC.md), so there is nothing here to read,
 * search or recover. The server's jobs are access control, ordering, quotas
 * and not losing writes.
 *
 * Ordering: every write gets the account's next change number (`seq`). A
 * device pulls "everything after the seq I have" and pushes records together
 * with the `baseSeq` it last saw for each. If the stored record has moved on,
 * the push is refused for that record (a conflict) and the device pulls,
 * merges, and tries again, so a write can never silently overwrite a newer one.
 */

/** Plans that include Quo Sync. */
export const SYNC_PLANS = ['pro_monthly', 'pro_yearly', 'sync_yearly'];
const ACTIVE_STATUSES = ['active', 'trialing', 'past_due'];

export const SYNC_KINDS = ['chat', 'memory'];
/** Clients that don't say which kinds they understand get chats only, as the first versions did. */
const DEFAULT_PULL_KINDS = ['chat'];
const MAX_BLOB_CHARS = 1_400_000; // about 1 MB of ciphertext, as base64
const MAX_VERIFIER_CHARS = 400;
const MAX_BATCH = 25;
const MAX_PULL = 100;
const MAX_RECORDS = 20_000;
// Chats use their own id; other kinds are prefixed (`memory:<id>`), and phone ids contain underscores.
const ID_PATTERN = /^[A-Za-z0-9_.:-]{8,100}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

const CALL_WINDOW_MS = 60_000;
/** Far above anything a working app does (a first sync of 20,000 chats makes about 800 calls over several minutes). */
const MAX_CALLS_PER_WINDOW = 600;
const callCounts = new Map<string, { start: number; count: number }>();

/**
 * Stops one account from being asked for more than MAX_CALLS_PER_WINDOW calls a
 * minute: a safety net for an app stuck in a retry loop. It counts per server
 * instance, so it is best effort, not a defence against someone determined.
 */
export function takeSyncCall(userId: string, now = Date.now()): boolean {
  if (callCounts.size > 5_000) {
    for (const [key, entry] of callCounts) if (now - entry.start >= CALL_WINDOW_MS) callCounts.delete(key);
  }
  const entry = callCounts.get(userId);
  if (!entry || now - entry.start >= CALL_WINDOW_MS) {
    callCounts.set(userId, { start: now, count: 1 });
    return true;
  }
  entry.count++;
  return entry.count <= MAX_CALLS_PER_WINDOW;
}

/** Who is calling, once sync is switched on, they're signed in, and they aren't calling too often. */
async function requireSync(request: Request): Promise<{ db: Db; userId: string }> {
  if (!features.sync) throw new HttpError(503, 'setup_required', SETUP_MESSAGES.sync);
  const db = await getDb();
  const { userId } = await identify(db, request);
  if (!userId) throw new HttpError(401, 'sign_in_required', 'Sign in to use Quo Sync.');
  if (!takeSyncCall(userId)) {
    throw new HttpError(429, 'slow_down', 'Quo Sync is being asked too often. It will catch up in a minute.', { 'retry-after': '60' });
  }
  return { db, userId };
}

export async function isSyncEntitled(db: Db, userId: string): Promise<boolean> {
  const rows = await db.query(
    'select 1 from subscriptions where user_id = $1 and status = any($2) and plan = any($3) limit 1',
    [userId, ACTIVE_STATUSES, SYNC_PLANS],
  );
  return rows.length > 0;
}

async function requireEntitled(db: Db, userId: string): Promise<void> {
  if (!(await isSyncEntitled(db, userId))) {
    throw new HttpError(402, 'sync_required', 'Quo Sync is part of Quo Pro and the Quo Sync plan.');
  }
}

interface SyncAccount {
  verifier: string;
  seq: number;
}

async function getAccount(db: Db, userId: string): Promise<SyncAccount | null> {
  const [row] = await db.query<SyncAccount>('select verifier, seq from sync_accounts where user_id = $1', [userId]);
  return row ?? null;
}

async function usage(db: Db, userId: string): Promise<{ bytes: number; records: number }> {
  const [row] = await db.query<{ bytes: number; records: number }>(
    'select coalesce(sum(size), 0)::int as bytes, count(*) filter (where not deleted)::int as records from sync_records where user_id = $1',
    [userId],
  );
  return row;
}

/** Where this account stands, for the app's Quo Sync screen. */
export async function handleSyncStatus(request: Request): Promise<Response> {
  const { db, userId } = await requireSync(request);
  const [entitled, account, used] = await Promise.all([isSyncEntitled(db, userId), getAccount(db, userId), usage(db, userId)]);
  return json({
    entitled,
    enabled: Boolean(account),
    // Ciphertext of a fixed phrase: lets a new device check a recovery key
    // before it downloads anything. Useless without that key.
    verifier: account?.verifier ?? null,
    seq: account?.seq ?? 0,
    usedBytes: used.bytes,
    limitBytes: config.syncLimitBytes,
    records: used.records,
  });
}

/** Starts sync for the account: stores the verifier made from the new recovery key. */
export async function handleSyncSetup(request: Request): Promise<Response> {
  const { db, userId } = await requireSync(request);
  await requireEntitled(db, userId);
  const { verifier } = await readJson<{ verifier?: unknown }>(request);
  if (typeof verifier !== 'string' || !verifier || verifier.length > MAX_VERIFIER_CHARS || !BASE64.test(verifier)) {
    throw new HttpError(400, 'bad_verifier', 'Invalid request.');
  }
  const created = await db.query('insert into sync_accounts (user_id, verifier) values ($1, $2) on conflict do nothing returning user_id', [userId, verifier]);
  if (created.length === 0) throw new HttpError(409, 'already_set_up', 'Quo Sync is already set up on this account. Enter your recovery key to join it.');
  return json({ ok: true });
}

/** Records changed after `since`, oldest first. Allowed after a plan lapses, so people can always get their data out. */
export async function handleSyncPull(request: Request): Promise<Response> {
  const { db, userId } = await requireSync(request);
  const account = await getAccount(db, userId);
  if (!account) throw new HttpError(404, 'sync_not_set_up', 'Quo Sync isn’t turned on for this account.');

  const params = new URL(request.url).searchParams;
  const since = Math.max(0, Number.parseInt(params.get('since') ?? '0', 10) || 0);
  const limit = Math.min(MAX_PULL, Math.max(1, Number.parseInt(params.get('limit') ?? String(MAX_PULL), 10) || MAX_PULL));
  const asked = (params.get('kinds') ?? '').split(',').filter(kind => SYNC_KINDS.includes(kind));
  const kinds = asked.length ? asked : DEFAULT_PULL_KINDS;
  const rows = await db.query<{ id: string; kind: string; seq: number; blob: string | null; deleted: boolean }>(
    'select id, kind, seq, blob, deleted from sync_records where user_id = $1 and seq > $2 and kind = any($3) order by seq limit $4',
    [userId, since, kinds, limit + 1],
  );
  const more = rows.length > limit;
  const records = rows.slice(0, limit);
  return json({ records, seq: more ? records.at(-1)!.seq : account.seq, more });
}

interface PushedRecord {
  id: string;
  kind: string;
  blob: string | null;
  deleted: boolean;
  baseSeq: number;
}

function validateRecords(value: unknown): PushedRecord[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_BATCH) {
    throw new HttpError(400, 'bad_batch', `Send between 1 and ${MAX_BATCH} records at a time.`);
  }
  const seen = new Set<string>();
  return value.map(item => {
    const record = item as Partial<PushedRecord>;
    const deleted = record.deleted === true;
    if (
      typeof record.id !== 'string' || !ID_PATTERN.test(record.id) || seen.has(record.id) ||
      typeof record.kind !== 'string' || !SYNC_KINDS.includes(record.kind) ||
      !Number.isInteger(record.baseSeq) || (record.baseSeq as number) < 0
    ) throw new HttpError(400, 'bad_record', 'Invalid record.');
    seen.add(record.id);
    if (!deleted) {
      if (typeof record.blob !== 'string' || record.blob.length === 0 || !BASE64.test(record.blob)) throw new HttpError(400, 'bad_record', 'Invalid record.');
      if (record.blob.length > MAX_BLOB_CHARS) throw new HttpError(413, 'record_too_large', 'That chat is too large to sync.');
    }
    return { id: record.id, kind: record.kind, blob: deleted ? null : record.blob!, deleted, baseSeq: record.baseSeq as number };
  });
}

export async function handleSyncPush(request: Request): Promise<Response> {
  const { db, userId } = await requireSync(request);
  await requireEntitled(db, userId);
  const { records: incoming } = await readJson<{ records?: unknown }>(request, 4 * 1024 * 1024);
  const records = validateRecords(incoming);

  const result = await db.tx(async t => {
    // Locking the account row makes concurrent pushes take turns, so change numbers are gap-free and ordered.
    const [account] = await t.query<{ seq: number }>('select seq from sync_accounts where user_id = $1 for update', [userId]);
    if (!account) throw new HttpError(404, 'sync_not_set_up', 'Quo Sync isn’t turned on for this account.');

    let { bytes, records: count } = await usage(t, userId);
    let seq = account.seq;
    const accepted: { id: string; seq: number }[] = [];
    const conflicts: string[] = [];

    for (const record of records) {
      const [existing] = await t.query<{ seq: number; size: number; deleted: boolean }>(
        'select seq, size, deleted from sync_records where user_id = $1 and id = $2',
        [userId, record.id],
      );
      if ((existing?.seq ?? 0) !== record.baseSeq) {
        conflicts.push(record.id);
        continue;
      }
      const size = record.blob?.length ?? 0;
      const delta = size - (existing?.size ?? 0);
      const isNew = !record.deleted && (!existing || existing.deleted);
      if ((delta > 0 && bytes + delta > config.syncLimitBytes) || (isNew && count >= MAX_RECORDS)) {
        throw new HttpError(413, 'quota_exceeded', 'Your Quo Sync storage is full. Delete some chats to make room.');
      }
      seq += 1;
      await t.query(
        `insert into sync_records (user_id, id, kind, seq, blob, deleted, size, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, now())
         on conflict (user_id, id) do update set seq = excluded.seq, blob = excluded.blob,
           deleted = excluded.deleted, size = excluded.size, updated_at = now()`,
        [userId, record.id, record.kind, seq, record.blob, record.deleted, size],
      );
      bytes += delta;
      if (record.deleted && existing && !existing.deleted) count -= 1;
      else if (isNew) count += 1;
      accepted.push({ id: record.id, seq });
    }
    if (seq !== account.seq) await t.query('update sync_accounts set seq = $2 where user_id = $1', [userId, seq]);
    return { seq, accepted, conflicts };
  });
  return json(result);
}

/** Deletes everything Quo Sync holds for this account (also the way to start over with a new recovery key). */
export async function handleSyncReset(request: Request): Promise<Response> {
  const { db, userId } = await requireSync(request);
  await db.tx(async t => {
    await t.query('delete from sync_records where user_id = $1', [userId]);
    await t.query('delete from sync_accounts where user_id = $1', [userId]);
  });
  return json({ ok: true });
}
