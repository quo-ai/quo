import { handleAccountDelete, handleMe } from './account.js';
import { handleAuthStart, handleAuthVerify, handleSignOut, handleSignOutEverywhere } from './auth.js';
import { handleBillingConfig, handleCheckout, handleDevComplete, handlePaddleWebhook, handlePortal } from './billing.js';
import { handleChat } from './chat.js';
import { publicCatalog } from './cloudModels.js';
import { errorResponse, HttpError, json } from './http.js';
import { handleCronSyncCleanup } from './syncRetention.js';
import { handleSyncPull, handleSyncPush, handleSyncReset, handleSyncSetup, handleSyncStatus } from './sync.js';

/**
 * The whole API behind one entry point: `handleApi(request, path)` with
 * `path` relative to /api. Web-standard Request → Response, so it runs on
 * the dev server today and on any serverless host later.
 */

type Handler = (request: Request) => Response | Promise<Response>;

const ROUTES: Record<string, Handler> = {
  'GET models': () => json(publicCatalog(), 200, { 'cache-control': 'public, max-age=300' }),
  'GET me': handleMe,
  'POST account/delete': handleAccountDelete,
  'POST auth/start': handleAuthStart,
  'POST auth/verify': handleAuthVerify,
  'POST auth/signout': handleSignOut,
  'POST auth/signout-all': handleSignOutEverywhere,
  'POST chat': handleChat,
  'GET billing/config': handleBillingConfig,
  'POST billing/checkout': handleCheckout,
  'GET billing/dev-complete': handleDevComplete,
  'POST billing/portal': handlePortal,
  'POST paddle/webhook': handlePaddleWebhook,
  'GET cron/sync-cleanup': handleCronSyncCleanup,
  'GET sync/status': handleSyncStatus,
  'POST sync/setup': handleSyncSetup,
  'GET sync/pull': handleSyncPull,
  'POST sync/push': handleSyncPush,
  'POST sync/reset': handleSyncReset,
};

export async function handleApi(request: Request, path: string): Promise<Response> {
  const route = ROUTES[`${request.method} ${path.replace(/^\/+|\/+$/g, '')}`];
  try {
    if (!route) throw new HttpError(404, 'not_found', 'Not found.');
    // State-changing requests must come from this site (CSRF guard; the
    // Paddle webhook is server-to-server and signed instead).
    if (request.method !== 'GET' && request.method !== 'HEAD' && path !== 'paddle/webhook') {
      const site = request.headers.get('sec-fetch-site');
      if (site && site !== 'same-origin' && site !== 'none') throw new HttpError(403, 'forbidden', 'Cross-site request blocked.');
    }
    return await route(request);
  } catch (error) {
    return errorResponse(error);
  }
}
