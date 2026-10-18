/**
 * Server configuration from environment variables. Every external service is
 * optional so the whole app runs in the dev sandbox with no accounts:
 *
 *   DATABASE_URL unset        → embedded PGlite (PGLITE_DIR to persist)
 *   OPENROUTER_API_KEY unset  → a stand-in model that streams a test reply
 *   RESEND_API_KEY unset      → sign-in codes are printed to the server log
 *   PADDLE_API_KEY unset      → purchases are simulated (dev only)
 *
 * In production (QUO_ENV=production) the secrets below are required.
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

  openRouterKey: env.OPENROUTER_API_KEY || null,
  /** The free, cheap default cloud model (an OpenRouter model id). */
  defaultCloudModel: env.DEFAULT_CLOUD_MODEL || 'openai/gpt-6-luna',
  freeDailyMessages: int(env.FREE_DAILY_MESSAGES, 20),
  freeDailyMessagesPerIp: int(env.FREE_DAILY_MESSAGES_PER_IP, 60),

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
      pack_1000: env.PADDLE_PRICE_PACK_1000 || null,
      pack_2750: env.PADDLE_PRICE_PACK_2750 || null,
      pack_6000: env.PADDLE_PRICE_PACK_6000 || null,
    },
  },
};
