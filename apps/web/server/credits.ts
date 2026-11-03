import { createHmac, randomUUID } from 'node:crypto';
import type { Db } from './db.js';
import { config } from './env.js';

/**
 * Credit ledger. All amounts are integer millicredits (1 credit = 1000).
 *
 * - Grants (monthly Pro allowance, packs, trial) each carry an expiry;
 *   spending draws from the soonest-expiring grant first.
 * - A cloud request reserves a hold before calling the model and settles the
 *   actual cost afterwards, so concurrent requests can never overspend and
 *   balances never go negative. Holds expire on their own if a request dies.
 * - Every change is recorded in credit_ledger.
 * - Pro's monthly allowance is granted lazily (on the first request of each
 *   subscription month), so monthly and yearly plans need no scheduled jobs.
 */

export const MILLI = 1000;
export const PRO_MONTHLY_CREDITS = 1000 * MILLI;
export const TRIAL_CREDITS = 25 * MILLI;
const TRIAL_DAYS = 90;
const PACK_MONTHS = 12;
const HOLD_TTL_MS = 10 * 60 * 1000;
const ACTIVE_STATUSES = ['active', 'trialing', 'past_due'];

export const PACK_CREDITS = { pack_1000: 1000, pack_2750: 2750, pack_6000: 6000 } as const;
export type PackId = keyof typeof PACK_CREDITS;

export function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

/** Whole months elapsed from `start` to `now` (by calendar anniversary). */
export function monthsBetween(start: Date, now: Date): number {
  let months = (now.getUTCFullYear() - start.getUTCFullYear()) * 12 + (now.getUTCMonth() - start.getUTCMonth());
  if (addMonths(start, months) > now) months--;
  return Math.max(0, months);
}

/** Adds a grant once per `ref` (idempotent). Returns true if it was new. */
export async function grantCredits(
  db: Db,
  userId: string,
  kind: 'monthly' | 'pack' | 'trial' | 'adjustment' | 'referral',
  amount: number,
  expiresAt: Date,
  ref: string,
): Promise<boolean> {
  const inserted = await db.query(
    `insert into credit_grants (id, user_id, kind, amount, remaining, expires_at, ref)
     values ($1, $2, $3, $4, $4, $5, $6) on conflict (ref) do nothing returning id`,
    [randomUUID(), userId, kind, amount, expiresAt, ref],
  );
  if (inserted.length === 0) return false;
  await db.query(
    'insert into credit_ledger (user_id, delta, reason, ref) values ($1, $2, $3, $4)',
    [userId, amount, `grant:${kind}`, ref],
  );
  return true;
}

/**
 * Takes back what is left of the grants whose ref starts with `prefix` (a refunded payment's packs or plan months), and
 * records it in the ledger. Credits already spent stay spent. Returns the credits taken back.
 */
export async function revokeGrants(db: Db, prefix: string, reason: string): Promise<number> {
  const taken = await db.query<{ user_id: string; remaining: number; ref: string }>(
    `with old as (select id, user_id, remaining, ref from credit_grants where starts_with(ref, $1) and remaining > 0 for update)
     update credit_grants g set remaining = 0 from old where g.id = old.id
     returning old.user_id, old.remaining, old.ref`,
    [prefix],
  );
  for (const row of taken) {
    await db.query('insert into credit_ledger (user_id, delta, reason, ref) values ($1, $2, $3, $4)', [row.user_id, -row.remaining, reason, row.ref]);
  }
  return taken.reduce((sum, row) => sum + row.remaining, 0);
}

/**
 * The free trial, once per email address: the first time, a keyed one-way hash of the address (a +tag dropped) is kept in
 * trial_claims for TRIAL_CLAIM_DAYS, also after the account is deleted. The hash can't be turned back into the address.
 * An account from before claims existed records its claim at its next sign-in (the grant itself is once per account).
 * `allow` is asked only for a claim that would be new (sign-in passes a per-address daily limit); when it says no, nothing
 * is recorded, so the trial comes at a later sign-in instead.
 */
export async function grantTrial(db: Db, userId: string, email: string, now = new Date(), allow?: () => Promise<boolean>): Promise<boolean> {
  const key = trialClaimKey(email);
  if (allow) {
    const seen = await db.query('select 1 from trial_claims where email_hash = $1', [key]);
    if (seen.length > 0 || !(await allow())) return false;
  }
  return db.tx(async t => {
    const claimed = await t.query('insert into trial_claims (email_hash, claimed_at) values ($1, $2) on conflict do nothing returning email_hash', [key, now]);
    if (claimed.length === 0) return false;
    return grantCredits(t, userId, 'trial', TRIAL_CREDITS, new Date(now.getTime() + TRIAL_DAYS * 86_400_000), `trial:${userId}`);
  });
}

export const TRIAL_CLAIM_DAYS = 365;

/**
 * The trial claim for an email address: name+tag@domain counts as name@domain, and for Gmail (which ignores dots and also
 * answers at googlemail.com) j.o.hn at googlemail.com counts as john at gmail.com. Keyed, so a list of addresses can't be checked against it.
 */
export function trialClaimKey(email: string): string {
  const [name, rawDomain] = email.trim().toLowerCase().split('@');
  const domain = rawDomain === 'googlemail.com' ? 'gmail.com' : rawDomain;
  const local = name.split('+')[0];
  return createHmac('sha256', config.sessionSecret).update(`trial-claim:${domain === 'gmail.com' ? local.replaceAll('.', '') : local}@${domain}`).digest('base64url');
}

/** Removes trial claims older than TRIAL_CLAIM_DAYS (the daily clean-up). */
export async function pruneTrialClaims(db: Db, now = new Date()): Promise<number> {
  const gone = await db.query('delete from trial_claims where claimed_at < $1 returning email_hash', [new Date(now.getTime() - TRIAL_CLAIM_DAYS * 86_400_000)]);
  return gone.length;
}

export function grantPack(db: Db, userId: string, pack: PackId, transactionId: string, now = new Date()): Promise<boolean> {
  return grantCredits(db, userId, 'pack', PACK_CREDITS[pack] * MILLI, addMonths(now, PACK_MONTHS), `txn:${transactionId}:${pack}`);
}

interface SubscriptionRow {
  id: string;
  started_at: Date;
  current_period_end: Date | null;
}

/** Grants this subscription month's Pro allowance if it hasn't been yet. */
export async function ensureMonthlyGrant(db: Db, userId: string, now = new Date()): Promise<void> {
  const subs = await db.query<SubscriptionRow>(
    `select id, started_at, current_period_end from subscriptions
     where user_id = $1 and status = any($2) and plan like 'pro\\_%' order by started_at`,
    [userId, ACTIVE_STATUSES],
  );
  for (const sub of subs) {
    const started = new Date(sub.started_at);
    if (started > now) continue;
    const k = monthsBetween(started, now);
    const periodStart = addMonths(started, k);
    if (sub.current_period_end && periodStart >= new Date(sub.current_period_end)) continue; // paid period over
    await grantCredits(db, userId, 'monthly', PRO_MONTHLY_CREDITS, addMonths(started, k + 1), `sub:${sub.id}:${k}`);
  }
}

export async function getBalance(db: Db, userId: string, now = new Date()): Promise<number> {
  const [row] = await db.query<{ granted: number; held: number }>(
    `select
       coalesce((select sum(remaining) from credit_grants where user_id = $1 and expires_at > $2 and remaining > 0), 0)::int as granted,
       coalesce((select sum(amount) from credit_holds where user_id = $1 and expires_at > $2), 0)::int as held`,
    [userId, now],
  );
  return Math.max(0, row.granted - row.held);
}

async function lockUser(db: Db, userId: string): Promise<void> {
  await db.query('select id from users where id = $1 for update', [userId]);
}

export interface Hold {
  id: string;
  amount: number;
}

/**
 * Reserves up to `want` millicredits, but no less than `min`. Returns null
 * when the balance can't cover `min`.
 */
export function reserveCredits(db: Db, userId: string, want: number, min: number, now = new Date()): Promise<Hold | null> {
  return db.tx(async t => {
    await lockUser(t, userId);
    await ensureMonthlyGrant(t, userId, now);
    const available = await getBalance(t, userId, now);
    if (available < min) return null;
    const amount = Math.min(want, available);
    const id = randomUUID();
    await t.query(
      'insert into credit_holds (id, user_id, amount, expires_at) values ($1, $2, $3, $4)',
      [id, userId, amount, new Date(now.getTime() + HOLD_TTL_MS)],
    );
    return { id, amount };
  });
}

/**
 * Releases the hold and charges `actual` (capped at what's available),
 * soonest-expiring grants first. Returns the amount charged and new balance.
 */
export function settleCredits(
  db: Db,
  userId: string,
  holdId: string,
  actual: number,
  reason: string,
  ref: string | null,
  now = new Date(),
): Promise<{ charged: number; balance: number }> {
  return db.tx(async t => {
    await lockUser(t, userId);
    await t.query('delete from credit_holds where id = $1', [holdId]);
    let left = Math.max(0, Math.ceil(actual));
    if (left > 0) {
      const grants = await t.query<{ id: string; remaining: number }>(
        `select id, remaining from credit_grants
         where user_id = $1 and remaining > 0 and expires_at > $2
         order by expires_at, created_at`,
        [userId, now],
      );
      for (const grant of grants) {
        if (left === 0) break;
        const take = Math.min(grant.remaining, left);
        await t.query('update credit_grants set remaining = remaining - $2 where id = $1', [grant.id, take]);
        left -= take;
      }
    }
    const charged = Math.max(0, Math.ceil(actual)) - left;
    if (charged > 0) {
      await t.query('insert into credit_ledger (user_id, delta, reason, ref) values ($1, $2, $3, $4)', [userId, -charged, reason, ref]);
    }
    return { charged, balance: await getBalance(t, userId, now) };
  });
}
