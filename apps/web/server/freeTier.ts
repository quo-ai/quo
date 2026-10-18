import type { Db } from './db';

/**
 * Daily free allowance for the default cloud model. Counted per user (when
 * signed in) or per device, and always per IP address as well, so clearing
 * storage or making new accounts doesn't multiply the free tier. Atomic:
 * either every counter is under its limit and all increment, or none do.
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

class LimitReached extends Error {}

export async function takeFreeMessage(db: Db, keys: FreeKeys, limits: FreeLimits, now = new Date()): Promise<boolean> {
  try {
    await db.tx(async t => {
      for (const [key, limit] of [[keys.subject, limits.perSubject], [`ip:${keys.ip}`, limits.perIp]] as const) {
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
    [day(now), [keys.subject, `ip:${keys.ip}`]],
  );
}

export async function freeRemaining(db: Db, keys: FreeKeys, limits: FreeLimits, now = new Date()): Promise<number> {
  const rows = await db.query<{ key: string; count: number }>(
    'select key, count from free_usage where day = $1 and key = any($2)',
    [day(now), [keys.subject, `ip:${keys.ip}`]],
  );
  const used = (key: string) => rows.find(row => row.key === key)?.count ?? 0;
  return Math.max(0, Math.min(limits.perSubject - used(keys.subject), limits.perIp - used(`ip:${keys.ip}`)));
}
