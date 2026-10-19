/**
 * Server configuration from environment variables. Every external service is
 * optional so the whole app runs in the dev sandbox with no accounts:
 *
 *   DATABASE_URL unset        → embedded PGlite (PGLITE_DIR to persist)
 *   OPENROUTER_API_KEY unset  → a stand-in model that streams a test reply
 *   RESEND_API_KEY unset      → sign-in codes are printed to the server log
 *   PADDLE_API_KEY unset      → purchases are simulated (dev only)
 *
 * In production (QUO_ENV=production) SESSION_SECRET and DATABASE_URL are
 * required. Services that aren't configured yet (see `features`) stay visible
 * in the app but answer with a `setup_required` error when used: no OpenRouter
 * key means no cloud models, no Resend key means no sign-in or paid models,
 * and no Paddle key means no purchases. Nothing is simulated in production.
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
  /** Web searches that come with the free model (each costs us a search fee, so it has its own, smaller allowance). */
  freeDailySearches: int(env.FREE_DAILY_SEARCHES, 3),
  freeDailySearchesPerIp: int(env.FREE_DAILY_SEARCHES_PER_IP, 10),

  /** Lets the host's scheduler call /api/cron/*; unset means those routes don't exist. */
  cronSecret: env.CRON_SECRET || null,
  /** Quo Sync: most encrypted data one account may keep. */
  syncLimitBytes: int(env.SYNC_LIMIT_MB, 250) * 1_000_000,

  resendKey: env.RESEND_API_KEY || null,
  emailFrom: env.EMAIL_FROM || 'Quo <hello@quoai.app>',

  paddle: {
    apiKey: env.PADDLE_API_KEY || null,
    webhookSecret: env.PADDLE_WEBHOOK_SECRET || null,
    clientToken: env.PADDLE_CLIENT_TOKEN || null,
    sandbox: env.PADDLE_ENV !== 'production',
    prices: {
      pro_monthly: env.PADDLE_PRICE_PRO_MONTHLY || null,
      pro_yearly: env.PADDLE_PRICE_PRO_YEARLY || null,
      sync_yearly: env.PADDLE_PRICE_SYNC_YEARLY || null,
      pack_1000: env.PADDLE_PRICE_PACK_1000 || null,
      pack_2750: env.PADDLE_PRICE_PACK_2750 || null,
      pack_6000: env.PADDLE_PRICE_PACK_6000 || null,
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
  /** Purchases: needs Paddle in production (and accounts, to buy as someone). */
  get billing() {
    return features.accounts && (!config.production || Boolean(config.paddle.apiKey));
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
