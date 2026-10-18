// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type Db } from '../db.js';
import {
  addMonths, ensureMonthlyGrant, getBalance, grantCredits, grantPack, grantTrial, MILLI, monthsBetween,
  reserveCredits, settleCredits,
} from '../credits.js';
import { freeRemaining, refundFreeMessage, takeFreeMessage } from '../freeTier.js';

let db: Db;
let userId: string;
const now = new Date('2026-10-06T12:00:00Z');

beforeEach(async () => {
  db = await createTestDb();
  userId = randomUUID();
  await db.query('insert into users (id, email) values ($1, $2)', [userId, `${userId}@example.com`]);
});

describe('dates', () => {
  it('clamps month ends', () => {
    expect(addMonths(new Date('2026-01-31T00:00:00Z'), 1).toISOString()).toBe('2026-02-28T00:00:00.000Z');
  });
  it('counts whole anniversary months', () => {
    expect(monthsBetween(new Date('2026-01-15T00:00:00Z'), new Date('2026-03-14T23:00:00Z'))).toBe(1);
    expect(monthsBetween(new Date('2026-01-15T00:00:00Z'), new Date('2026-03-15T00:00:00Z'))).toBe(2);
  });
});

describe('grants', () => {
  it('are idempotent per ref', async () => {
    expect(await grantTrial(db, userId, now)).toBe(true);
    expect(await grantTrial(db, userId, now)).toBe(false);
    expect(await getBalance(db, userId, now)).toBe(25 * MILLI);
  });

  it('ignore expired credit', async () => {
    await grantCredits(db, userId, 'adjustment', 5 * MILLI, new Date(now.getTime() - 1000), 'old');
    expect(await getBalance(db, userId, now)).toBe(0);
  });

  it('give Pro its monthly allowance once per subscription month, monthly or yearly', async () => {
    await db.query(
      `insert into subscriptions (id, user_id, plan, status, started_at, current_period_end) values ('sub_1', $1, 'pro_yearly', 'active', $2, $3)`,
      [userId, new Date('2026-08-20T00:00:00Z'), new Date('2027-08-20T00:00:00Z')],
    );
    await ensureMonthlyGrant(db, userId, now);
    await ensureMonthlyGrant(db, userId, now);
    expect(await getBalance(db, userId, now)).toBe(1000 * MILLI);
    // Next month: a fresh allowance; the old one has expired.
    const nextMonth = new Date('2026-10-21T00:00:00Z');
    await ensureMonthlyGrant(db, userId, nextMonth);
    expect(await getBalance(db, userId, nextMonth)).toBe(1000 * MILLI);
  });

  it('stop the allowance once the paid period has ended', async () => {
    await db.query(
      `insert into subscriptions (id, user_id, plan, status, started_at, current_period_end) values ('sub_2', $1, 'pro_monthly', 'active', $2, $3)`,
      [userId, new Date('2026-08-06T00:00:00Z'), new Date('2026-09-06T00:00:00Z')],
    );
    await ensureMonthlyGrant(db, userId, now);
    expect(await getBalance(db, userId, now)).toBe(0);
  });
});

describe('reserve and settle', () => {
  it('holds credit, charges the actual cost, releases the rest', async () => {
    await grantTrial(db, userId, now);
    const hold = await reserveCredits(db, userId, 10 * MILLI, 1 * MILLI, now);
    expect(hold?.amount).toBe(10 * MILLI);
    expect(await getBalance(db, userId, now)).toBe(15 * MILLI);
    const result = await settleCredits(db, userId, hold!.id, 1500, 'chat', 'r1', now);
    expect(result).toEqual({ charged: 1500, balance: 25 * MILLI - 1500 });
  });

  it('caps the hold at the balance and refuses below the minimum', async () => {
    await grantCredits(db, userId, 'adjustment', 2 * MILLI, addMonths(now, 1), 'small');
    expect((await reserveCredits(db, userId, 10 * MILLI, 1 * MILLI, now))?.amount).toBe(2 * MILLI);
    expect(await reserveCredits(db, userId, 10 * MILLI, 1 * MILLI, now)).toBeNull(); // all held
  });

  it('spends the soonest-expiring credit first', async () => {
    await grantPack(db, userId, 'pack_1000', 'txn_1', now); // expires in 12 months
    await grantCredits(db, userId, 'adjustment', 3 * MILLI, addMonths(now, 1), 'soon');
    const hold = await reserveCredits(db, userId, 5 * MILLI, 1, now);
    await settleCredits(db, userId, hold!.id, 4 * MILLI, 'chat', null, now);
    const rows = await db.query<{ ref: string; remaining: number }>('select ref, remaining from credit_grants order by ref');
    expect(rows).toEqual([{ ref: 'soon', remaining: 0 }, { ref: 'txn:txn_1:pack_1000', remaining: 999 * MILLI }]);
  });

  it('never overspends under concurrent requests', async () => {
    await grantCredits(db, userId, 'adjustment', 5 * MILLI, addMonths(now, 1), 'five');
    const holds = await Promise.all(Array.from({ length: 4 }, () => reserveCredits(db, userId, 2 * MILLI, 2 * MILLI, now)));
    expect(holds.filter(Boolean)).toHaveLength(2);
  });
});

describe('free tier', () => {
  const keys = { subject: 'device:abc', ip: '1.2.3.4' };
  it('allows up to the daily limit, then refuses; refunds give one back', async () => {
    const limits = { perSubject: 2, perIp: 10 };
    expect(await takeFreeMessage(db, keys, limits, now)).toBe(true);
    expect(await takeFreeMessage(db, keys, limits, now)).toBe(true);
    expect(await takeFreeMessage(db, keys, limits, now)).toBe(false);
    expect(await freeRemaining(db, keys, limits, now)).toBe(0);
    await refundFreeMessage(db, keys, now);
    expect(await freeRemaining(db, keys, limits, now)).toBe(1);
  });

  it('also limits per IP across devices', async () => {
    const limits = { perSubject: 5, perIp: 1 };
    expect(await takeFreeMessage(db, keys, limits, now)).toBe(true);
    expect(await takeFreeMessage(db, { subject: 'device:other', ip: '1.2.3.4' }, limits, now)).toBe(false);
  });

  it('never stores an IP address or device id', async () => {
    await takeFreeMessage(db, { subject: 'device:private-id', ip: '203.0.113.7' }, { perSubject: 5, perIp: 5 }, now);
    const rows = await db.query<{ key: string }>('select key from free_usage');
    expect(rows.length).toBeGreaterThan(0);
    for (const { key } of rows) {
      expect(key).not.toContain('203.0.113.7');
      expect(key).not.toContain('private-id');
    }
  });
});
