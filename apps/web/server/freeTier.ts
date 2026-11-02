import { createHmac } from 'node:crypto';
import type { Db } from './db.js';
import { config } from './env.js';

/**
 * Daily free allowance for the default cloud model. Counted per user (when
 * signed in) or per device, and always per IP address as well, so clearing
 * storage or making new accounts doesn't multiply the free tier. Atomic:
 * either every counter is under its limit and all increment, or none do.
 *
 * Privacy: keys are stored as keyed hashes, so the table never holds an IP
 * address, email or device id, and counters are deleted after two days.
 */

export interface FreeKeys {
  /** `user:<id>` when signed in, otherwise `device:<id>`. */
  subject: string;
  ip: string;
}

export interface FreeLimits {
  perSubject: number;
  perIp: number;
}

const day = (now: Date) => now.toISOString().slice(0, 10);
const hashed = (key: string) => createHmac('sha256', config.sessionSecret).update(key).digest('base64url').slice(0, 32);
const subjectKey = (keys: FreeKeys) => hashed(keys.subject);
const ipKey = (keys: FreeKeys) => hashed(`ip:${keys.ip}`);
const RETENTION_DAYS = 2;

/** Drops counters from before yesterday. Cheap, so it runs on a small share of requests. */
async function pruneOldCounters(db: Db, now: Date): Promise<void> {
  if (Math.random() > 0.05) return;
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 86_400_000);
  await db.query('delete from free_usage where day < $1', [day(cutoff)]);
}

class LimitReached extends Error {}

export interface FreeTake {
  ok: boolean;
  /** The subject's first use today (counted, as a total only, in the daily figures: costs.ts). */
  firstToday: boolean;
}

/** Takes `uses` from the allowance (a change to an image counts as two), on every counter or none. */
export async function takeFree(db: Db, keys: FreeKeys, limits: FreeLimits, { now = new Date(), uses = 1 } = {}): Promise<FreeTake> {
  let firstToday = false;
  try {
    await db.tx(async t => {
      for (const [key, limit, isSubject] of [[subjectKey(keys), limits.perSubject, true], [ipKey(keys), limits.perIp, false]] as const) {
        if (limit <= 0 || uses > limit) throw new LimitReached();
        const rows = await t.query<{ count: number }>(
          `insert into free_usage (key, day, count) values ($1, $2, $4)
           on conflict (key, day) do update set count = free_usage.count + $4
           where free_usage.count + $4 <= $3
           returning count`,
          [key, day(now), limit, uses],
        );
        if (rows.length === 0) throw new LimitReached();
        if (isSubject) firstToday = rows[0].count === uses;
      }
    });
    await pruneOldCounters(db, now);
    return { ok: true, firstToday };
  } catch (error) {
    if (error instanceof LimitReached) return { ok: false, firstToday: false };
    throw error;
  }
}

export async function takeFreeMessage(db: Db, keys: FreeKeys, limits: FreeLimits, now = new Date(), uses = 1): Promise<boolean> {
  return (await takeFree(db, keys, limits, { now, uses })).ok;
}

/** Gives back a free message (the request failed before any reply). */
export async function refundFreeMessage(db: Db, keys: FreeKeys, now = new Date(), uses = 1): Promise<void> {
  await db.query(
    'update free_usage set count = greatest(count - $3, 0) where day = $1 and key = any($2)',
    [day(now), [subjectKey(keys), ipKey(keys)], uses],
  );
}

export async function freeRemaining(db: Db, keys: FreeKeys, limits: FreeLimits, now = new Date()): Promise<number> {
  const rows = await db.query<{ key: string; count: number }>(
    'select key, count from free_usage where day = $1 and key = any($2)',
    [day(now), [subjectKey(keys), ipKey(keys)]],
  );
  const used = (key: string) => rows.find(row => row.key === key)?.count ?? 0;
  return Math.max(0, Math.min(limits.perSubject - used(subjectKey(keys)), limits.perIp - used(ipKey(keys))));
}
