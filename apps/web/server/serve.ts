import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { sendWebResponse, setIsolationHeaders, toWebRequest } from './node.js';
import { getDb } from './db.js';
import { handleApi } from './routes.js';
import { cleanupSync } from './syncRetention.js';

/**
 * Standalone server for self-hosting: the built app (dist/) plus the API,
 * in one Node process. `npm run build && npm start`; put it behind a reverse
 * proxy that terminates TLS and sets X-Forwarded-For.
 *
 *   PORT (default 3000), plus the API's variables (see server/env.ts).
 */

const ROOT = resolve(process.env.QUO_WEB_DIR ?? 'dist');
const PORT = Number(process.env.PORT ?? 3000);

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

async function fileFor(path: string): Promise<string | null> {
  const file = normalize(join(ROOT, decodeURIComponent(path)));
  if (!file.startsWith(ROOT)) return null;
  try {
    return (await stat(file)).isFile() ? file : null;
  } catch {
    return null;
  }
}

createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  try {
    if (path.startsWith('/api/')) {
      const request = await toWebRequest(req, res);
      return await sendWebResponse(res, await handleApi(request, path.slice('/api/'.length)));
    }
    setIsolationHeaders(path, res);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Unknown paths fall back to the app (single page).
    const file = (await fileFor(path === '/' ? '/index.html' : path)) ?? (await fileFor('/index.html'));
    if (!file) {
      res.statusCode = 404;
      return void res.end('Not found');
    }
    res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
    res.setHeader('Cache-Control', path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
    createReadStream(file).pipe(res);
  } catch (error) {
    console.error('[quo]', error);
    if (!res.headersSent) res.statusCode = 500;
    res.end();
  }
}).listen(PORT, () => console.log(`Quo Web on http://localhost:${PORT}`));

// There's no scheduler here, so run the daily Quo Sync clean-up (server/syncRetention.ts) on a timer.
const runCleanup = () => getDb().then(db => cleanupSync(db)).then(
  result => (result.deletedAccounts || result.warned || result.prunedMarkers) && console.log('[quo] sync clean-up', result),
  error => console.error('[quo] sync clean-up failed', error),
);
setTimeout(runCleanup, 2 * 60_000).unref();
setInterval(runCleanup, 24 * 60 * 60_000).unref();
