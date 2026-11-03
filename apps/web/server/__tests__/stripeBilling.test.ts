// @vitest-environment node
import { createHmac, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { applyStripeEvent, handleStripeWebhook, stripeForm, type StripeEvent } from '../billing.js';
import { ensureMonthlyGrant, getBalance, MILLI } from '../credits.js';
import { createTestDb, getDb, type Db } from '../db.js';
import { config } from '../env.js';

let db: Db;
let userId: string;
const SECRET = 'whsec_test_secret';

beforeAll(() => {
  config.stripe.prices.pack_1000 = 'price_pack_1000';
  config.stripe.prices.pro_monthly = 'price_pro_monthly';
});
afterAll(() => {
  config.stripe.webhookSecret = null;
});
beforeEach(async () => {
  db = await createTestDb();
  userId = randomUUID();
  await db.query('insert into users (id, email) values ($1, $2)', [userId, `${userId}@example.com`]);
});

const paidPack = (purchase: string, status = 'paid'): StripeEvent => ({
  id: `evt_${randomUUID()}`,
  type: 'checkout.session.completed',
  data: { object: { id: `cs_${purchase}`, mode: 'payment', payment_status: status, customer: 'cus_1', metadata: { user_id: userId, product: 'pack_1000', purchase } } },
});
const credits = async () => (await getBalance(db, userId)) / MILLI;

it('a paid credit pack gives its credits once, and a bank payment still on its way gives them when it arrives', async () => {
  await applyStripeEvent(db, paidPack('p1'));
  await applyStripeEvent(db, paidPack('p1'));
  expect(await credits()).toBe(1000);
  expect(await db.query('select stripe_customer_id from users where id = $1', [userId])).toEqual([{ stripe_customer_id: 'cus_1' }]);

  await applyStripeEvent(db, paidPack('p2', 'unpaid'));
  expect(await credits()).toBe(1000);
  await applyStripeEvent(db, { ...paidPack('p2'), type: 'checkout.session.async_payment_succeeded' });
  expect(await credits()).toBe(2000);
});

it('a refund of a pack takes back what is left of it; a plan’s refund takes back that plan’s months', async () => {
  await applyStripeEvent(db, paidPack('p3'));
  await applyStripeEvent(db, { id: 'evt_r1', type: 'charge.refunded', data: { object: { id: 'ch_1', payment_intent: 'pi_1', customer: 'cus_1' } } }, async intent => (intent === 'pi_1' ? 'p3' : null));
  expect(await credits()).toBe(0);

  await applyStripeEvent(db, {
    id: 'evt_s1',
    type: 'customer.subscription.created',
    data: { object: { id: 'sub_1', status: 'active', customer: 'cus_1', start_date: Math.floor(Date.now() / 1000) - 60, metadata: { user_id: userId }, items: { data: [{ price: { id: 'price_pro_monthly' }, current_period_end: Math.floor(Date.now() / 1000) + 30 * 86_400 }] } } },
  });
  await ensureMonthlyGrant(db, userId);
  expect(await credits()).toBe(1000);
  // The plan's invoice payment carries no purchase id of ours: the customer's plan months go.
  await applyStripeEvent(db, { id: 'evt_r2', type: 'charge.refunded', data: { object: { id: 'ch_2', payment_intent: 'pi_2', customer: 'cus_1' } } }, async () => null);
  expect(await credits()).toBe(0);

  await applyStripeEvent(db, { id: 'evt_s2', type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', status: 'canceled', metadata: { user_id: userId }, items: { data: [{ price: { id: 'price_pro_monthly' } }] } } } });
  expect(await db.query('select status from subscriptions where id = $1', ['sub_1'])).toEqual([{ status: 'canceled' }]);
});

it('the webhook takes only events signed with the webhook secret, and each event once', async () => {
  config.stripe.webhookSecret = SECRET;
  const live = await getDb();
  const id = randomUUID();
  await live.query('insert into users (id, email) values ($1, $2)', [id, `${id}@example.com`]);
  const body = JSON.stringify({ id: `evt_${id}`, type: 'checkout.session.completed', data: { object: { id: 'cs_w', mode: 'payment', payment_status: 'paid', metadata: { user_id: id, product: 'pack_1000', purchase: `w_${id}` } } } });
  const send = (signature: string) => handleStripeWebhook(new Request('http://localhost/api/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': signature }, body }));
  const t = Math.floor(Date.now() / 1000);
  const good = `t=${t},v1=${createHmac('sha256', SECRET).update(`${t}.${body}`).digest('hex')}`;

  await expect(send(`t=${t},v1=${'0'.repeat(64)}`)).rejects.toMatchObject({ status: 401 });
  expect((await send(good)).status).toBe(200);
  expect((await send(good)).status).toBe(200); // Stripe retries: the same event changes nothing twice
  expect((await getBalance(live, id)) / MILLI).toBe(1000);
});

it('encodes requests the way Stripe reads them', () => {
  expect(stripeForm({ mode: 'payment', line_items: [{ price: 'price_1', quantity: 1 }], managed_payments: { enabled: true }, metadata: { user_id: 'u 1' }, skip: undefined })).toEqual([
    'mode=payment',
    `${encodeURIComponent('line_items[0][price]')}=price_1`,
    `${encodeURIComponent('line_items[0][quantity]')}=1`,
    `${encodeURIComponent('managed_payments[enabled]')}=true`,
    `${encodeURIComponent('metadata[user_id]')}=u%201`,
  ]);
});
