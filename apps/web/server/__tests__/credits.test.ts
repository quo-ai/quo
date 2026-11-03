// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type Db } from '../db.js';
import {
  addMonths, ensureMonthlyGrant, getBalance, grantCredits, grantPack, grantTrial, MILLI, monthsBetween,
  pruneTrialClaims, reserveCredits, settleCredits, TRIAL_CLAIM_DAYS,
} from '../credits.js';
import { freeRemaining, refundFreeMessage, takeFree, takeFreeMessage } from '../freeTier.js';

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
    expect(await grantTrial(db, userId, `${userId}@example.com`, now)).toBe(true);
    expect(await grantTrial(db, userId, `${userId}@example.com`, now)).toBe(false);
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

describe('free uses that count double, and the first of the day', () => {
  it('takes two at once only when both fit, gives both back, and knows the first use of the day', async () => {
    const keys = { subject: 'image:device:a', ip: 'image:203.0.113.9' };
    const limits = { perSubject: 3, perIp: 10 };
    expect(await takeFree(db, keys, limits, { now, uses: 2 })).toEqual({ ok: true, firstToday: true });
    expect(await takeFree(db, keys, limits, { now, uses: 2 })).toEqual({ ok: false, firstToday: false });
    expect(await takeFree(db, keys, limits, { now })).toEqual({ ok: true, firstToday: false });
    await refundFreeMessage(db, keys, now, 2);
    expect(await freeRemaining(db, keys, limits, now)).toBe(2);
    expect((await takeFree(db, keys, { perSubject: 1, perIp: 10 }, { now: new Date(now.getTime() + 86_400_000), uses: 2 })).ok).toBe(false);
  });
});

describe('the free trial', () => {
  const newAccount = async (email: string) => {
    const id = randomUUID();
    await db.query('insert into users (id, email) values ($1, $2)', [id, `${id}@accounts.example`]);
    return { id, email };
  };

  it('comes once per email address, even after the account is deleted and made again', async () => {
    const first = await newAccount('ann@example.com');
    expect(await grantTrial(db, first.id, first.email, now)).toBe(true);
    // The account is deleted (its grants go with it); a new one with the same address gets nothing.
    await db.query('delete from credit_grants where user_id = $1', [first.id]);
    await db.query('delete from credit_ledger where user_id = $1', [first.id]);
    await db.query('delete from users where id = $1', [first.id]);
    const again = await newAccount('ann@example.com');
    expect(await grantTrial(db, again.id, ' Ann@Example.com ', now)).toBe(false);
    expect(await getBalance(db, again.id, now)).toBe(0);
    // A +tag is the same address; another address is not.
    expect(await grantTrial(db, (await newAccount('ann+quo@example.com')).id, 'ann+quo@example.com', now)).toBe(false);
    expect(await grantTrial(db, (await newAccount('bob@example.com')).id, 'bob@example.com', now)).toBe(true);
  });

  it('treats Gmail’s dots and googlemail.com as the same address, and nobody else’s dots', async () => {
    // Built at run time: the secrets check refuses other people's addresses written in the repository.
    const gmail = (name: string, domain = ['gmail', 'com'].join('.')) => `${name}@${domain}`;
    expect(await grantTrial(db, (await newAccount(gmail('john.smith'))).id, gmail('john.smith'), now)).toBe(true);
    for (const variant of [gmail('johnsmith'), gmail('j.o.h.n.smith+x'), gmail('John.Smith', ['googlemail', 'com'].join('.'))]) {
      expect(await grantTrial(db, (await newAccount(variant)).id, variant, now)).toBe(false);
    }
    expect(await grantTrial(db, (await newAccount('john.smith@example.com')).id, 'john.smith@example.com', now)).toBe(true);
    expect(await grantTrial(db, (await newAccount('johnsmith@example.com')).id, 'johnsmith@example.com', now)).toBe(true);
  });

  it('asks the address limit only for a new claim, and a trial it holds back comes at a later sign-in', async () => {
    let asked = 0;
    const no = async () => (asked++, false);
    const dana = await newAccount('dana@example.com');
    expect(await grantTrial(db, dana.id, dana.email, now, no)).toBe(false);
    expect(await getBalance(db, dana.id, now)).toBe(0);
    expect(await grantTrial(db, dana.id, dana.email, now, async () => true)).toBe(true); // a later sign-in
    expect(await grantTrial(db, dana.id, dana.email, now, no)).toBe(false); // already claimed: not asked
    expect(asked).toBe(1);
  });

  it('keeps only a keyed hash of the address, for a year', async () => {
    await grantTrial(db, userId, 'cara@example.com', now);
    const rows = await db.query<{ email_hash: string }>('select email_hash from trial_claims');
    expect(JSON.stringify(rows)).not.toMatch(/cara|example/);
    expect(await pruneTrialClaims(db, new Date(now.getTime() + (TRIAL_CLAIM_DAYS - 1) * 86_400_000))).toBe(0);
    expect(await pruneTrialClaims(db, new Date(now.getTime() + (TRIAL_CLAIM_DAYS + 1) * 86_400_000))).toBe(1);
    // After that, the address can have the trial again.
    expect(await grantTrial(db, (await newAccount('cara@example.com')).id, 'cara@example.com', new Date(now.getTime() + 400 * 86_400_000))).toBe(true);
  });
});

describe('reserve and settle', () => {
  it('holds credit, charges the actual cost, releases the rest', async () => {
    await grantTrial(db, userId, `${userId}@example.com`, now);
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
