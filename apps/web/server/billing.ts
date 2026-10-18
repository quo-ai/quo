import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { addMonths, grantPack, PACK_CREDITS, type PackId } from './credits.js';
import { getDb, type Db } from './db.js';
import { config, features, SETUP_MESSAGES } from './env.js';
import { HttpError, json, readJson } from './http.js';
import { identify } from './identity.js';

/**
 * Billing through Paddle (merchant of record: handles VAT / sales tax).
 *
 * Checkout: the server creates a Paddle transaction tagged with the user's
 * id and sends the browser to /checkout.html?_ptxn=…, a page outside the
 * app's cross-origin isolation where Paddle.js opens the checkout. Paddle
 * then calls the webhook, which grants packs and records subscriptions.
 *
 * Without Paddle keys (sandbox), checkout completes instantly through
 * /api/billing/dev-complete so the whole flow can be tested.
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

const isProduct = (value: unknown): value is ProductId => typeof value === 'string' && value in PRODUCTS;
const isPack = (product: ProductId): product is PackId => product in PACK_CREDITS;
const paddleApi = () => (config.paddle.sandbox ? 'https://sandbox-api.paddle.com' : 'https://api.paddle.com');

async function paddle<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${paddleApi()}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${config.paddle.apiKey}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`paddle_${response.status}: ${(await response.text()).slice(0, 200)}`);
  return ((await response.json()) as { data: T }).data;
}

async function requireUser(request: Request): Promise<string> {
  const { userId } = await identify(await getDb(), request);
  if (!userId) throw new HttpError(401, 'sign_in_required', 'Sign in first.');
  return userId;
}

export function handleBillingConfig(): Response {
  return json({
    live: Boolean(config.paddle.apiKey),
    paddle: config.paddle.clientToken ? { clientToken: config.paddle.clientToken, sandbox: config.paddle.sandbox } : null,
    products: Object.entries(PRODUCTS).map(([id, product]) => ({ id, ...product })),
  });
}

export async function handleCheckout(request: Request): Promise<Response> {
  if (!features.billing) throw new HttpError(503, 'setup_required', SETUP_MESSAGES.billing);
  const userId = await requireUser(request);
  const { product } = await readJson<{ product?: string }>(request);
  if (!isProduct(product)) throw new HttpError(400, 'unknown_product', 'Unknown product.');

  if (!config.paddle.apiKey) return json({ url: `/api/billing/dev-complete?product=${product}` }); // development only
  const priceId = config.paddle.prices[product];
  if (!priceId) throw new HttpError(503, 'setup_required', SETUP_MESSAGES.billing);
  const db = await getDb();
  const [user] = await db.query<{ email: string; paddle_customer_id: string | null }>(
    'select email, paddle_customer_id from users where id = $1', [userId],
  );
  const transaction = await paddle<{ id: string }>('/transactions', {
    items: [{ price_id: priceId, quantity: 1 }],
    custom_data: { user_id: userId },
    ...(user?.paddle_customer_id ? { customer_id: user.paddle_customer_id } : {}),
  });
  return json({ url: `/checkout.html?_ptxn=${encodeURIComponent(transaction.id)}` });
}

/** Sandbox only: completes a purchase immediately. */
export async function handleDevComplete(request: Request): Promise<Response> {
  if (config.production || config.paddle.apiKey) throw new HttpError(404, 'not_found');
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

export async function handlePortal(request: Request): Promise<Response> {
  if (!features.billing) throw new HttpError(503, 'setup_required', SETUP_MESSAGES.billing);
  const userId = await requireUser(request);
  if (!config.paddle.apiKey) return json({ url: null, message: 'Subscription management is available once billing is live.' });
  const db = await getDb();
  const [user] = await db.query<{ paddle_customer_id: string | null }>('select paddle_customer_id from users where id = $1', [userId]);
  if (!user?.paddle_customer_id) throw new HttpError(404, 'no_customer', 'No purchases on this account yet.');
  const subs = await db.query<{ id: string }>(`select id from subscriptions where user_id = $1 and status <> 'canceled'`, [userId]);
  const session = await paddle<{ urls: { general: { overview: string } } }>(
    `/customers/${user.paddle_customer_id}/portal-sessions`,
    { subscription_ids: subs.map(s => s.id) },
  );
  return json({ url: session.urls.general.overview });
}

// ---------- Webhook ----------

/** Paddle-Signature: ts=…;h1=… over `${ts}:${rawBody}`, within 5 minutes. */
export function verifyPaddleSignature(header: string | null, rawBody: string, secret: string, now = Date.now()): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(';').map(part => part.split('=') as [string, string]));
  const ts = Number(parts.ts);
  if (!parts.h1 || !Number.isFinite(ts) || Math.abs(now / 1000 - ts) > 300) return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(`${parts.ts}:${rawBody}`).digest('hex'));
  const given = Buffer.from(parts.h1);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

interface PaddleEvent {
  event_id: string;
  event_type: string;
  data: {
    id: string;
    status?: string;
    customer_id?: string | null;
    custom_data?: { user_id?: string } | null;
    items?: { price?: { id?: string } | null; price_id?: string }[];
    started_at?: string | null;
    first_billed_at?: string | null;
    current_billing_period?: { ends_at?: string } | null;
  };
}

const productForPrice = (priceId: string | undefined): ProductId | undefined =>
  (Object.entries(config.paddle.prices) as [ProductId, string | null][]).find(([, id]) => id && id === priceId)?.[0];

export async function handlePaddleWebhook(request: Request): Promise<Response> {
  const secret = config.paddle.webhookSecret;
  if (!secret) throw new HttpError(404, 'not_found');
  const raw = await request.text();
  if (!verifyPaddleSignature(request.headers.get('paddle-signature'), raw, secret)) {
    throw new HttpError(401, 'bad_signature');
  }
  const event = JSON.parse(raw) as PaddleEvent;
  const db = await getDb();
  await db.tx(async t => {
    const fresh = await t.query('insert into processed_events (id) values ($1) on conflict do nothing returning id', [event.event_id]);
    if (fresh.length === 0) return; // already handled
    await applyPaddleEvent(t, event);
  });
  return json({ ok: true });
}

export async function applyPaddleEvent(db: Db, event: PaddleEvent): Promise<void> {
  const { data } = event;
  const userId = data.custom_data?.user_id;
  if (!userId) return;
  const [user] = await db.query('select id from users where id = $1', [userId]);
  if (!user) return;
  if (data.customer_id) await db.query('update users set paddle_customer_id = $2 where id = $1', [userId, data.customer_id]);

  if (event.event_type === 'transaction.completed') {
    for (const item of data.items ?? []) {
      const product = productForPrice(item.price?.id ?? item.price_id);
      if (product && isPack(product)) await grantPack(db, userId, product, data.id);
    }
    return;
  }

  if (event.event_type.startsWith('subscription.')) {
    const product = productForPrice(data.items?.[0]?.price?.id ?? data.items?.[0]?.price_id);
    if (!product || isPack(product)) return;
    const started = data.started_at ?? data.first_billed_at ?? new Date().toISOString();
    await db.query(
      `insert into subscriptions (id, user_id, plan, status, started_at, current_period_end, updated_at)
       values ($1, $2, $3, $4, $5, $6, now())
       on conflict (id) do update set plan = excluded.plan, status = excluded.status,
         current_period_end = excluded.current_period_end, updated_at = now()`,
      [data.id, userId, product, data.status ?? 'active', new Date(started), data.current_billing_period?.ends_at ? new Date(data.current_billing_period.ends_at) : null],
    );
  }
}
