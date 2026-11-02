// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { beforeEach, expect, it } from 'vitest';
import { recordCost } from '../costs.js';
import { grantCredits, MILLI } from '../credits.js';
import { createTestDb, type Db } from '../db.js';
import { collectStats } from '../stats.js';

let db: Db;
const now = new Date('2026-11-20T12:00:00Z');
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);
const user = async (created = daysAgo(3)) => {
  const id = randomUUID();
  await db.query('insert into users (id, email, created_at) values ($1, $2, $3)', [id, `${id}@example.com`, created]);
  return id;
};

beforeEach(async () => {
  db = await createTestDb();
});

it('adds up the free tier’s cost per person, paid use, sales, how much of Pro and the trial is used, and accounts', async () => {
  // Free use over two days: 3 people-days, $0.03 of chat and two images for $0.018.
  for (const day of [daysAgo(1), daysAgo(1), daysAgo(2)]) await recordCost(db, 'people:free', { now: day });
  for (let i = 0; i < 3; i++) await recordCost(db, 'chat:free', { usd: 0.01, now: daysAgo(1) });
  await recordCost(db, 'image:free', { usd: 0.009, now: daysAgo(1) });
  await recordCost(db, 'image:free', { usd: 0.009, now: daysAgo(2) });
  // Paid use: one chat, 2.5 credits charged. And something older than the period, which doesn't count.
  await recordCost(db, 'chat:paid', { usd: 0.0125, charged: 2.5 * MILLI, now: daysAgo(1) });
  await recordCost(db, 'chat:free', { usd: 5, now: daysAgo(40) });

  const buyer = await user();
  await grantCredits(db, buyer, 'pack', 2750 * MILLI, daysAgo(-300), 'txn:txn_a:pack_2750');
  const pro = await user(daysAgo(60));
  await db.query(`insert into subscriptions (id, user_id, plan, status, started_at, current_period_end, updated_at) values ('sub_1', $1, 'pro_monthly', 'active', $2, $3, now())`, [pro, daysAgo(10), daysAgo(-20)]);
  // A finished Pro month that used 400 of its 1,000 credits.
  await grantCredits(db, pro, 'monthly', 1000 * MILLI, daysAgo(5), 'sub:sub_1:0');
  await db.query(`update credit_grants set remaining = $1 where ref = 'sub:sub_1:0'`, [600 * MILLI]);
  // A trial that ended in the period with 5 of its 25 credits used, and one still running.
  await grantCredits(db, pro, 'trial', 25 * MILLI, daysAgo(2), `trial:${pro}`);
  await db.query(`update credit_grants set remaining = $1 where ref = $2`, [20 * MILLI, `trial:${pro}`]);
  await grantCredits(db, buyer, 'trial', 25 * MILLI, daysAgo(-80), `trial:${buyer}`);
  await user();

  const stats = await collectStats(db, 30, now);
  expect(stats.free).toMatchObject({ personDays: 3, requests: 5, images: 2 });
  expect(stats.free.usd).toBeCloseTo(0.048);
  expect(stats.free.usdPerPersonDay).toBeCloseTo(0.016);
  expect(stats.paid).toMatchObject({ requests: 1, credits: 2.5 });
  expect(stats.sales).toEqual({ packs: { pack_2750: 1 }, newPlans: { pro_monthly: 1 }, activePlans: { pro_monthly: 1 }, newSalesUsd: 42 });
  expect(stats.allowance).toEqual({ months: 1, usedShare: 0.4 });
  expect(stats.trial).toMatchObject({ ended: 1, usedShare: 0.2 });
  expect(stats.accounts).toEqual({ total: 3, new: 2, paying: 2, conversion: 2 / 3 });
});

it('says "not yet" rather than dividing by nothing', async () => {
  const stats = await collectStats(db, 30, now);
  expect(stats.free.usdPerPersonDay).toBeNull();
  expect(stats.allowance.usedShare).toBeNull();
  expect(stats.accounts.conversion).toBeNull();
});
