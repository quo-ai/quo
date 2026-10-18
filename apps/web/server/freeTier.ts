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

export async function takeFreeMessage(db: Db, keys: FreeKeys, limits: FreeLimits, now = new Date()): Promise<boolean> {
  try {
    await db.tx(async t => {
      for (const [key, limit] of [[subjectKey(keys), limits.perSubject], [ipKey(keys), limits.perIp]] as const) {
        const rows = await t.query(
          `insert into free_usage (key, day, count) values ($1, $2, 1)
           on conflict (key, day) do update set count = free_usage.count + 1
           where free_usage.count < $3
           returning count`,
          [key, day(now), limit],
        );
        if (rows.length === 0 || limit <= 0) throw new LimitReached();
      }
    });
    await pruneOldCounters(db, now);
    return true;
  } catch (error) {
    if (error instanceof LimitReached) return false;
    throw error;
  }
}

/** Gives back a free message (the request failed before any reply). */
export async function refundFreeMessage(db: Db, keys: FreeKeys, now = new Date()): Promise<void> {
  await db.query(
    'update free_usage set count = greatest(count - 1, 0) where day = $1 and key = any($2)',
    [day(now), [subjectKey(keys), ipKey(keys)]],
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
