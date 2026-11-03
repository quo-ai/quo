import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { addMonths, grantPack, PACK_CREDITS, revokeGrants, type PackId } from './credits.js';
import { rewardReferrer } from './referrals.js';
import { getDb, type Db } from './db.js';
import { config, features, SETUP_MESSAGES } from './env.js';
import { HttpError, json, readJson } from './http.js';
import { identify } from './identity.js';

/**
 * Billing through Stripe, with Managed Payments: Stripe is the merchant of record (it handles VAT, sales tax, fraud and
 * disputes), and the checkout is Stripe's own page.
 *
 * Checkout: the server makes a Checkout Session for one product, tagged with the user's id and a purchase id of its own,
 * and the app sends the person there (the desktop app opens it in the browser). Stripe comes back to the app with
 * ?checkout=success and calls the webhook, which grants packs, records plans and takes back what a refund refunds.
 *
 * Without a Stripe key (the sandbox), checkout completes at once through /api/billing/dev-complete, so the whole flow
 * can be tried. A test-mode key (sk_test_) takes test cards, and the app says purchases are only a test.
 */

export const PRODUCTS = {
  pro_monthly: { label: 'Quo Pro · monthly', price: '$12 / month', credits: 1000 },
  pro_yearly: { label: 'Quo Pro · yearly', price: '$99 / year', credits: 1000 },
  sync_yearly: { label: 'Quo Sync · yearly', price: '$24 / year', credits: 0 },
  pack_1000: { label: '1,000 credits', price: '$12', credits: 1000 },
  pack_2750: { label: '2,750 credits', price: '$30', credits: 2750 },
  pack_6000: { label: '6,000 credits', price: '$60', credits: 6000 },
} as const;
export type ProductId = keyof typeof PRODUCTS;

/** The API version every request and the webhook use (Managed Payments needs 2025-03-31.basil or later). */
export const STRIPE_VERSION = '2025-03-31.basil';

const isProduct = (value: unknown): value is ProductId => typeof value === 'string' && value in PRODUCTS;
const isPack = (product: ProductId): product is PackId => product in PACK_CREDITS;

/** Stripe's form encoding: nested objects and arrays as key[sub][0]=value. */
export function stripeForm(params: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(params).flatMap(([key, value]) => {
    const name = prefix ? `${prefix}[${key}]` : key;
    if (value === undefined || value === null) return [];
    if (Array.isArray(value)) return value.flatMap((item, i) => (typeof item === 'object' && item !== null ? stripeForm(item as Record<string, unknown>, `${name}[${i}]`) : [`${encodeURIComponent(`${name}[${i}]`)}=${encodeURIComponent(String(item))}`]));
    if (typeof value === 'object') return stripeForm(value as Record<string, unknown>, name);
    return [`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`];
  });
}

async function stripe<T>(method: 'GET' | 'POST', path: string, params?: Record<string, unknown>): Promise<T> {
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${config.stripe.secretKey}`, 'stripe-version': STRIPE_VERSION, ...(params ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
    body: params ? stripeForm(params).join('&') : undefined,
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(`stripe_${response.status}: ${String(body.error?.message ?? '').slice(0, 200)}`);
  return body;
}

async function requireUser(request: Request): Promise<string> {
  const { userId } = await identify(await getDb(), request);
  if (!userId) throw new HttpError(401, 'sign_in_required', 'Sign in first.');
  return userId;
}

/** Real money only with a live key; a test key takes test cards. */
export const billingLive = () => Boolean(config.stripe.secretKey?.startsWith('sk_live_'));

export function handleBillingConfig(): Response {
  return json({ live: billingLive(), products: Object.entries(PRODUCTS).map(([id, product]) => ({ id, ...product })) });
}

export async function handleCheckout(request: Request): Promise<Response> {
  if (!features.billing) throw new HttpError(503, 'setup_required', SETUP_MESSAGES.billing);
  const userId = await requireUser(request);
  const { product } = await readJson<{ product?: string }>(request);
  if (!isProduct(product)) throw new HttpError(400, 'unknown_product', 'Unknown product.');

  if (!config.stripe.secretKey) return json({ url: `/api/billing/dev-complete?product=${product}` }); // development only
  const priceId = config.stripe.prices[product];
  if (!priceId) throw new HttpError(503, 'setup_required', SETUP_MESSAGES.billing);
  const db = await getDb();
  const [user] = await db.query<{ email: string; stripe_customer_id: string | null }>('select email, stripe_customer_id from users where id = $1', [userId]);
  // Our own id for this purchase: the credits it gives are filed under it, so a refund of it finds them.
  const tags = { user_id: userId, product, purchase: randomUUID() };
  const plan = !isPack(product);
  const session = await stripe<{ url: string }>('POST', '/checkout/sessions', {
    mode: plan ? 'subscription' : 'payment',
    line_items: [{ price: priceId, quantity: 1 }],
    managed_payments: { enabled: true },
    client_reference_id: userId,
    metadata: tags,
    ...(plan ? { subscription_data: { metadata: tags } } : { payment_intent_data: { metadata: tags }, customer_creation: 'always' }),
    ...(user?.stripe_customer_id ? { customer: user.stripe_customer_id } : { customer_email: user?.email }),
    success_url: `${config.appUrl}/?checkout=success&product=${product}`,
    cancel_url: `${config.appUrl}/?checkout=cancelled`,
  });
  return json({ url: session.url });
}

/** Sandbox only: completes a purchase immediately. */
export async function handleDevComplete(request: Request): Promise<Response> {
  if (config.production || config.stripe.secretKey) throw new HttpError(404, 'not_found');
  const userId = await requireUser(request);
  const product = new URL(request.url).searchParams.get('product');
  if (!isProduct(product)) throw new HttpError(400, 'unknown_product');
  const db = await getDb();
  const id = `dev_${randomUUID()}`;
  if (isPack(product)) {
    await grantPack(db, userId, product, id);
  } else {
    const now = new Date();
    await db.query(
      `insert into subscriptions (id, user_id, plan, status, started_at, current_period_end) values ($1, $2, $3, 'active', $4, $5)`,
      [id, userId, product, now, addMonths(now, product === 'pro_yearly' || product === 'sync_yearly' ? 12 : 1)],
    );
  }
  return new Response(null, { status: 302, headers: { location: `/?checkout=success&product=${product}` } });
}

/** "Manage subscription": Stripe's customer portal, back to the app afterwards. */
export async function handlePortal(request: Request): Promise<Response> {
  if (!features.billing) throw new HttpError(503, 'setup_required', SETUP_MESSAGES.billing);
  const userId = await requireUser(request);
  if (!config.stripe.secretKey) return json({ url: null, message: 'Subscription management is available once billing is live.' });
  const db = await getDb();
  const [user] = await db.query<{ stripe_customer_id: string | null }>('select stripe_customer_id from users where id = $1', [userId]);
  if (!user?.stripe_customer_id) throw new HttpError(404, 'no_customer', 'No purchases on this account yet.');
  try {
    const session = await stripe<{ url: string }>('POST', '/billing_portal/sessions', { customer: user.stripe_customer_id, return_url: `${config.appUrl}/` });
    return json({ url: session.url });
  } catch (error) {
    console.error('[billing] portal', error instanceof Error ? error.message : error);
    return json({ url: null, message: 'Manage your plan from the receipt Stripe emailed you, or at link.com with the email you paid with.' });
  }
}

// ---------- Webhook ----------

/** Stripe-Signature: t=…,v1=… (one or more v1), each an HMAC-SHA256 of `${t}.${rawBody}`, within 5 minutes. */
export function verifyStripeSignature(header: string | null, rawBody: string, secret: string, now = Date.now()): boolean {
  if (!header) return false;
  const parts = header.split(',').map(part => part.split('=') as [string, string]);
  const t = parts.find(([key]) => key === 't')?.[1];
  const signatures = parts.filter(([key]) => key === 'v1').map(([, value]) => value);
  const ts = Number(t);
  if (!t || !signatures.length || !Number.isFinite(ts) || Math.abs(now / 1000 - ts) > 300) return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex'));
  return signatures.some(signature => {
    const given = Buffer.from(signature);
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

interface StripeObject {
  id: string;
  object?: string;
  mode?: string;
  status?: string;
  payment_status?: string;
  customer?: string | null;
  client_reference_id?: string | null;
  metadata?: Record<string, string> | null;
  payment_intent?: string | null;
  charge?: string | null;
  start_date?: number;
  current_period_end?: number;
  items?: { data?: { price?: { id?: string }; current_period_end?: number }[] };
}
export interface StripeEvent {
  id: string;
  type: string;
  data: { object: StripeObject };
}

const productForPrice = (priceId: string | undefined): ProductId | undefined =>
  (Object.entries(config.stripe.prices) as [ProductId, string | null][]).find(([, id]) => id && id === priceId)?.[0];

export async function handleStripeWebhook(request: Request): Promise<Response> {
  const secret = config.stripe.webhookSecret;
  if (!secret) throw new HttpError(404, 'not_found');
  const raw = await request.text();
  if (!verifyStripeSignature(request.headers.get('stripe-signature'), raw, secret)) throw new HttpError(401, 'bad_signature');
  const event = JSON.parse(raw) as StripeEvent;
  const db = await getDb();
  await db.tx(async t => {
    const fresh = await t.query('insert into processed_events (id) values ($1) on conflict do nothing returning id', [event.id]);
    if (fresh.length === 0) return; // already handled
    await applyStripeEvent(t, event);
  });
  return json({ ok: true });
}

const userExists = async (db: Db, id: string | null | undefined) => Boolean(id && (await db.query('select 1 from users where id = $1', [id])).length);

export async function applyStripeEvent(db: Db, event: StripeEvent, lookup = lookupPurchase): Promise<void> {
  const object = event.data.object;
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const userId = object.metadata?.user_id ?? object.client_reference_id;
    if (!(await userExists(db, userId))) return;
    if (object.customer) await db.query('update users set stripe_customer_id = $2 where id = $1', [userId, object.customer]);
    // A bank payment that hasn't arrived yet comes back as checkout.session.async_payment_succeeded.
    if (object.payment_status !== 'paid' && object.payment_status !== 'no_payment_required') return;
    const product = object.metadata?.product;
    const purchase = object.metadata?.purchase ?? object.id;
    if (object.mode === 'payment' && isProduct(product) && isPack(product)) await grantPack(db, userId!, product, purchase);
    // The first payment (a pack or a plan) of an invited account rewards whoever invited it.
    await rewardReferrer(db, userId!, purchase);
    return;
  }

  if (event.type.startsWith('customer.subscription.')) {
    const userId = object.metadata?.user_id;
    if (!(await userExists(db, userId))) return;
    const item = object.items?.data?.[0];
    const product = productForPrice(item?.price?.id);
    if (!product || isPack(product)) return;
    const status = event.type === 'customer.subscription.deleted' ? 'canceled' : (object.status ?? 'active');
    const periodEnd = item?.current_period_end ?? object.current_period_end;
    await db.query(
      `insert into subscriptions (id, user_id, plan, status, started_at, current_period_end, updated_at)
       values ($1, $2, $3, $4, $5, $6, now())
       on conflict (id) do update set plan = excluded.plan, status = excluded.status,
         current_period_end = excluded.current_period_end, updated_at = now()`,
      [object.id, userId, product, status, new Date((object.start_date ?? Date.now() / 1000) * 1000), periodEnd ? new Date(periodEnd * 1000) : null],
    );
    if (object.customer) await db.query('update users set stripe_customer_id = $2 where id = $1', [userId, object.customer]);
    return;
  }

  // A refund (whole or part) or a chargeback: the credits still unused from that payment go.
  if (event.type === 'charge.refunded' || event.type === 'charge.dispute.created') {
    const reason = `${event.type === 'charge.refunded' ? 'refund' : 'chargeback'}:${object.id}`;
    const purchase = object.payment_intent ? await lookup(object.payment_intent) : null;
    if (purchase) {
      await revokeGrants(db, `txn:${purchase}:`, reason);
      return;
    }
    // A plan's payment (made by its invoice, so without our purchase id): that customer's plan months go.
    if (!object.customer) return;
    const subs = await db.query<{ id: string }>('select s.id from subscriptions s join users u on u.id = s.user_id where u.stripe_customer_id = $1', [object.customer]);
    for (const sub of subs) await revokeGrants(db, `sub:${sub.id}:`, reason);
  }
}

/** Our purchase id for a payment, from the payment's metadata (set at checkout); null for a plan's invoice payment. */
async function lookupPurchase(paymentIntent: string): Promise<string | null> {
  const intent = await stripe<{ metadata?: Record<string, string> }>('GET', `/payment_intents/${encodeURIComponent(paymentIntent)}`);
  return intent.metadata?.purchase ?? null;
}
