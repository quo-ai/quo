import { timingSafeEqual } from 'node:crypto';
import { getDb, type Db } from './db.js';
import { sendSyncLapseNotice } from './email.js';
import { config } from './env.js';
import { HttpError, json } from './http.js';
import { SYNC_PLANS } from './sync.js';

/**
 * How long Quo Sync keeps what it holds, once the plan that paid for it ends:
 *
 *  - Synced chats stay readable and downloadable for 180 days after the plan
 *    ends (pulling always works; only uploading needs a plan). Subscribing again
 *    in that time picks up exactly where it stopped.
 *  - 30 days before the end (day 150) the account's email gets one warning.
 *  - Then the encrypted copy is deleted for good.
 *  - Deletion markers (what tells other devices a chat was deleted) are pruned
 *    after 90 days. A device that was offline longer keeps its own copy of that
 *    chat rather than learning it was deleted; nothing is ever resurrected in
 *    the cloud, because only changed chats are uploaded.
 *
 * Runs once a day (Vercel Cron hits /api/cron/sync-cleanup; the standalone
 * server runs it on a timer). Safe to run as often as you like.
 */

export const RETENTION_DAYS = 180;
export const WARN_BEFORE_DAYS = 30;
export const MARKER_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_STATUSES = ['active', 'trialing', 'past_due'];

export interface CleanupResult {
  deletedAccounts: number;
  warned: number;
  prunedMarkers: number;
}

export async function cleanupSync(db: Db, now = new Date()): Promise<CleanupResult> {
  const result: CleanupResult = { deletedAccounts: 0, warned: 0, prunedMarkers: 0 };

  // Anyone who subscribed again is no longer on the clock.
  await db.query(
    `update sync_accounts a set warned_at = null where warned_at is not null and exists (
       select 1 from subscriptions s where s.user_id = a.user_id and s.status = any($1) and s.plan = any($2))`,
    [ACTIVE_STATUSES, SYNC_PLANS],
  );

  const lapsed = await db.query<{ user_id: string; email: string; created_at: Date; warned_at: Date | null; lapsed_since: Date | null }>(
    `select a.user_id, u.email, a.created_at, a.warned_at,
            (select max(coalesce(s.current_period_end, s.updated_at)) from subscriptions s where s.user_id = a.user_id and s.plan = any($2)) as lapsed_since
     from sync_accounts a join users u on u.id = a.user_id
     where not exists (select 1 from subscriptions s where s.user_id = a.user_id and s.status = any($1) and s.plan = any($2))`,
    [ACTIVE_STATUSES, SYNC_PLANS],
  );

  for (const account of lapsed) {
    const since = new Date(account.lapsed_since ?? account.created_at).getTime();
    const deleteAt = since + RETENTION_DAYS * DAY_MS;
    if (now.getTime() >= deleteAt) {
      await db.tx(async t => {
        await t.query('delete from sync_records where user_id = $1', [account.user_id]);
        await t.query('delete from sync_accounts where user_id = $1', [account.user_id]);
      });
      result.deletedAccounts++;
    } else if (now.getTime() >= deleteAt - WARN_BEFORE_DAYS * DAY_MS && !account.warned_at) {
      try {
        await sendSyncLapseNotice(account.email, new Date(deleteAt));
        await db.query('update sync_accounts set warned_at = $2 where user_id = $1', [account.user_id, now]);
        result.warned++;
      } catch (error) {
        console.error('[sync] couldn’t send the retention notice:', error); // tried again tomorrow
      }
    }
  }

  const pruned = await db.query<{ id: string }>(
    'delete from sync_records where deleted and updated_at < $1 returning id',
    [new Date(now.getTime() - MARKER_DAYS * DAY_MS)],
  );
  result.prunedMarkers = pruned.length;
  return result;
}

/** GET /api/cron/sync-cleanup, called by the host's scheduler with `Authorization: Bearer $CRON_SECRET`. */
export async function handleCronSyncCleanup(request: Request): Promise<Response> {
  const secret = config.cronSecret;
  if (!secret) throw new HttpError(404, 'not_found');
  const given = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new HttpError(401, 'unauthorized');
  return json(await cleanupSync(await getDb()));
}
