// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, expect, it } from 'vitest';
import { applyPaddleEvent } from '../billing.js';
import { ensureMonthlyGrant, getBalance, MILLI, reserveCredits, settleCredits } from '../credits.js';
import { createTestDb, type Db } from '../db.js';
import { config } from '../env.js';

let db: Db;
let userId: string;

beforeAll(() => {
  config.paddle.prices.pack_1000 = 'pri_pack_1000';
  config.paddle.prices.pro_monthly = 'pri_pro_monthly';
});
beforeEach(async () => {
  db = await createTestDb();
  userId = randomUUID();
  await db.query('insert into users (id, email) values ($1, $2)', [userId, `${userId}@example.com`]);
});

const event = (event_type: string, data: Record<string, unknown>) => applyPaddleEvent(db, { event_id: randomUUID(), event_type, data: data as never });
const buyPack = (txn: string) => event('transaction.completed', { id: txn, custom_data: { user_id: userId }, items: [{ price: { id: 'pri_pack_1000' } }] });
const refund = (fields: Record<string, unknown>) => event('adjustment.updated', { id: `adj_${randomUUID()}`, action: 'refund', status: 'approved', ...fields });
const spend = async (credits: number) => {
  const hold = await reserveCredits(db, userId, credits * MILLI, credits * MILLI);
  await settleCredits(db, userId, hold!.id, credits * MILLI, 'chat:test', randomUUID());
};

it('a refunded credit pack takes back only the credits not yet used, once approved', async () => {
  await buyPack('txn_a');
  await buyPack('txn_b');
  await spend(300);
  expect(await getBalance(db, userId)).toBe(1700 * MILLI);

  // Waiting for approval, or rejected: nothing changes.
  await event('adjustment.created', { id: 'adj_1', action: 'refund', status: 'pending_approval', transaction_id: 'txn_a' });
  await refund({ transaction_id: 'txn_a', status: 'rejected' });
  expect(await getBalance(db, userId)).toBe(1700 * MILLI);

  // The first pack paid for the 300 spent: 700 of it go, the other pack stays whole. Doing it twice changes nothing.
  await refund({ transaction_id: 'txn_a' });
  await refund({ transaction_id: 'txn_a' });
  expect(await getBalance(db, userId)).toBe(1000 * MILLI);
  const ledger = await db.query<{ delta: number; reason: string }>(`select delta, reason from credit_ledger where user_id = $1 and delta < 0 and reason like 'refund:%'`, [userId]);
  expect(ledger.map(row => row.delta)).toEqual([-700 * MILLI]);
});

it('a chargeback counts like a refund; credits and other actions don’t take anything', async () => {
  await buyPack('txn_c');
  await event('adjustment.created', { id: 'adj_credit', action: 'credit', status: 'approved', transaction_id: 'txn_c' });
  expect(await getBalance(db, userId)).toBe(1000 * MILLI);
  await event('adjustment.created', { id: 'adj_cb', action: 'chargeback', status: 'approved', transaction_id: 'txn_c' });
  expect(await getBalance(db, userId)).toBe(0);
});

it('a refunded plan payment takes back that plan’s monthly credits', async () => {
  await event('subscription.created', { id: 'sub_1', status: 'active', custom_data: { user_id: userId }, items: [{ price: { id: 'pri_pro_monthly' } }], started_at: new Date().toISOString() });
  await ensureMonthlyGrant(db, userId);
  expect(await getBalance(db, userId)).toBe(1000 * MILLI);
  await refund({ transaction_id: 'txn_sub_1', subscription_id: 'sub_1' });
  expect(await getBalance(db, userId)).toBe(0);
});
