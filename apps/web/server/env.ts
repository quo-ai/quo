/**
 * Server configuration from environment variables. Every external service is
 * optional so the whole app runs in the dev sandbox with no accounts:
 *
 *   DATABASE_URL unset        → embedded PGlite (PGLITE_DIR to persist)
 *   OPENROUTER_API_KEY unset  → a stand-in model that streams a test reply
 *   RESEND_API_KEY unset      → sign-in codes are printed to the server log
 *   STRIPE_SECRET_KEY unset   → purchases are simulated (dev only)
 *
 * In production (QUO_ENV=production) SESSION_SECRET and DATABASE_URL are
 * required. Services that aren't configured yet (see `features`) stay visible
 * in the app but answer with a `setup_required` error when used: no OpenRouter
 * key means no cloud models, no Resend key means no sign-in or paid models,
 * and no Stripe key means no purchases. Nothing is simulated in production.
 */

const env = process.env;
const int = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const production = env.QUO_ENV === 'production';

function required(name: string, devFallback: string): string {
  const value = env[name];
  if (value) return value;
  if (production) throw new Error(`${name} must be set in production`);
  return devFallback;
}

export const config = {
  production,
  appUrl: (env.APP_URL ?? 'http://localhost:5173').replace(/\/$/, ''),
  databaseUrl: env.DATABASE_URL || null,
  pgliteDir: env.PGLITE_DIR || null,
  get sessionSecret() {
    return required('SESSION_SECRET', 'dev-sandbox-secret-not-for-production');
  },

  get databaseRequired() {
    return production && !env.DATABASE_URL;
  },

  openRouterKey: env.OPENROUTER_API_KEY || null,
  /** The free, cheap default cloud model (an OpenRouter model id). */
  defaultCloudModel: env.DEFAULT_CLOUD_MODEL || 'openai/gpt-6-luna',
  freeDailyMessages: int(env.FREE_DAILY_MESSAGES, 20),
  freeDailyMessagesPerIp: int(env.FREE_DAILY_MESSAGES_PER_IP, 60),
  /** Steps of Code mode that come with the free model (each step is a request; a coding reply takes several). */
  freeDailyCodeSteps: int(env.FREE_DAILY_CODE_STEPS, 60),
  freeDailyCodeStepsPerIp: int(env.FREE_DAILY_CODE_STEPS_PER_IP, 150),
  /** Web searches that come with the free model (each costs us a search fee, so it has its own, smaller allowance). */
  freeDailySearches: int(env.FREE_DAILY_SEARCHES, 3),
  freeDailySearchesPerIp: int(env.FREE_DAILY_SEARCHES_PER_IP, 10),
  /** Images that come free every day (each costs us about a cent: server/images.ts), on any model. */
  freeDailyImages: int(env.FREE_DAILY_IMAGES, 3),
  freeDailyImagesPerIp: int(env.FREE_DAILY_IMAGES_PER_IP, 10),
  /** What the free tier (free model, its Code mode and searches, free images) may cost Quo in a day, for everyone together, in
   * US cents. Past it, free use pauses until midnight UTC: paid use and offline models carry on. 0 means no limit. */
  freeDailyBudgetCents: int(env.FREE_DAILY_BUDGET_CENTS, 500),

  /** Lets the host's scheduler call /api/cron/*; unset means those routes don't exist. */
  cronSecret: env.CRON_SECRET || null,
  /** Quo Sync: most encrypted data one account may keep. */
  syncLimitBytes: int(env.SYNC_LIMIT_MB, 250) * 1_000_000,

  resendKey: env.RESEND_API_KEY || null,
  emailFrom: env.EMAIL_FROM || 'Quo <signin@quo.computer>',

  /** Stripe with Managed Payments (server/billing.ts): a live key (sk_live_) takes real money, a test key test cards. */
  stripe: {
    secretKey: env.STRIPE_SECRET_KEY || null,
    webhookSecret: env.STRIPE_WEBHOOK_SECRET || null,
    /** With a test key in production, only these accounts may buy (with test cards): anyone else would get credits for nothing. */
    testers: (env.STRIPE_TEST_EMAILS || '').split(',').map(email => email.trim().toLowerCase()).filter(Boolean),
    prices: {
      pro_monthly: env.STRIPE_PRICE_PRO_MONTHLY || null,
      pro_yearly: env.STRIPE_PRICE_PRO_YEARLY || null,
      sync_yearly: env.STRIPE_PRICE_SYNC_YEARLY || null,
      pack_1000: env.STRIPE_PRICE_PACK_1000 || null,
      pack_2750: env.STRIPE_PRICE_PACK_2750 || null,
      pack_6000: env.STRIPE_PRICE_PACK_6000 || null,
    },
  },
};

/**
 * Which services are set up. Anything off still shows in the app and answers
 * with `setup_required` when used. Development simulates every service.
 * (Read from `config` so tests can switch them.)
 */
export const features = {
  /** Cloud models: needs an OpenRouter key in production. */
  get cloud() {
    return !config.production || Boolean(config.openRouterKey);
  },
  /** Sign-in by emailed code, and with it paid models and sync: needs Resend in production. */
  get accounts() {
    return !config.production || Boolean(config.resendKey);
  },
  /** Purchases: needs Stripe in production (and accounts, to buy as someone). */
  get billing() {
    return features.accounts && (!config.production || Boolean(config.stripe.secretKey));
  },
  /** Quo Sync: encrypted chat sync for signed-in subscribers, so it needs accounts. */
  get sync() {
    return features.accounts;
  },
};

export const SETUP_MESSAGES = {
  accounts: 'Sign-in isn’t set up yet. It’s coming soon.',
  paidModels: 'Paid models aren’t set up yet. For now, use the free model or an offline model.',
  billing: 'Purchases aren’t set up yet. They’re coming soon.',
  sync: 'Quo Sync isn’t set up yet. It’s coming soon.',
} as const;
