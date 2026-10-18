import { ensureMonthlyGrant, getBalance } from './credits.js';
import { getDb, type Db } from './db.js';
import { config, features } from './env.js';
import { freeRemaining } from './freeTier.js';
import { json } from './http.js';
import { freeSubject, identify, type Identity } from './identity.js';
import { SYNC_PLANS } from './sync.js';

export interface AccountSummary {
  user: { email: string } | null;
  plan: 'free' | 'pro';
  /** Quo Sync is included (Pro, or the Sync plan). */
  sync: boolean;
  subscription: { plan: string; status: string; renewsAt: string | null } | null;
  /** Credits (not millicredits), one decimal; null when signed out. */
  credits: number | null;
  free: { limit: number; remaining: number };
  billing: { live: boolean };
  /** What this deployment offers, so the app only shows what works. */
  features: { cloud: boolean; accounts: boolean; billing: boolean };
}

export async function accountSummary(db: Db, identity: Identity): Promise<AccountSummary> {
  const limits = { perSubject: config.freeDailyMessages, perIp: config.freeDailyMessagesPerIp };
  const free = { limit: config.freeDailyMessages, remaining: await freeRemaining(db, { subject: freeSubject(identity), ip: identity.ip }, limits) };
  const billing = { live: Boolean(config.paddle.apiKey) };
  const offered = { cloud: features.cloud, accounts: features.accounts, billing: features.billing };
  const signedOut: AccountSummary = { user: null, plan: 'free', sync: false, subscription: null, credits: null, free, billing, features: offered };
  if (!identity.userId) return signedOut;

  const [user] = await db.query<{ email: string }>('select email from users where id = $1', [identity.userId]);
  if (!user) return signedOut;
  await ensureMonthlyGrant(db, identity.userId);
  const subs = await db.query<{ plan: string; status: string; current_period_end: Date | null }>(
    `select plan, status, current_period_end from subscriptions
     where user_id = $1 and status in ('active', 'trialing', 'past_due') order by updated_at desc`,
    [identity.userId],
  );
  const sub = subs.find(s => s.plan.startsWith('pro_')) ?? subs[0];
  const balance = await getBalance(db, identity.userId);
  return {
    user: { email: user.email },
    plan: subs.some(s => s.plan.startsWith('pro_')) ? 'pro' : 'free',
    sync: subs.some(s => SYNC_PLANS.includes(s.plan)),
    subscription: sub ? { plan: sub.plan, status: sub.status, renewsAt: sub.current_period_end ? new Date(sub.current_period_end).toISOString() : null } : null,
    credits: Math.round(balance / 100) / 10,
    free,
    billing,
    features: offered,
  };
}

export async function handleMe(request: Request): Promise<Response> {
  return json(await accountSummary(await getDb(), identify(request)));
}
