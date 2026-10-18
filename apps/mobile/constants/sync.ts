/**
 * Where Quo Sync (and the sign-in it needs) talks to. This is the hosted Quo Web
 * API; it moves with it when Quo gets its own domain (also WEB_APP_URL in
 * apps/web/src/platform.ts and API_ORIGIN in apps/desktop/src/protocol.js).
 */
export const SYNC_API_ORIGIN = 'https://quoai-app.vercel.app';
