import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, type Plugin, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Cross-origin isolation enables SharedArrayBuffer, which wllama needs for
// multi-threaded CPU inference. The Paddle checkout page is exempt: it embeds
// Paddle's checkout, which can't run cross-origin isolated.
const ISOLATION_EXEMPT = ['/checkout.html'];
function isolationHeaders(req: IncomingMessage, res: ServerResponse, next: () => void) {
  const path = (req.url ?? '/').split('?')[0];
  if (!ISOLATION_EXEMPT.includes(path)) {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  }
  next();
}

/**
 * Serves the API (server/routes.ts) from the dev server, so the sandbox runs
 * app + API in one process. Node request → Web Request → Node response,
 * streaming bodies through (server-sent events for chat).
 */
function quoApi(): Plugin {
  return {
    name: 'quo-api',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(isolationHeaders);
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();
        try {
          const { handleApi } = await server.ssrLoadModule('/server/routes.ts');
          const request = await toWebRequest(req, res);
          const response: Response = await handleApi(request, new URL(request.url).pathname.slice('/api/'.length));
          await sendWebResponse(res, response);
        } catch (error) {
          server.config.logger.error(`[api] ${String(error)}`);
          if (!res.headersSent) res.statusCode = 500;
          res.end();
        }
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use(isolationHeaders);
    },
  };
}

async function toWebRequest(req: IncomingMessage, res: ServerResponse): Promise<Request> {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach(v => headers.append(key, v));
    else if (value !== undefined) headers.set(key, value);
  }
  if (!headers.has('x-forwarded-for') && req.socket.remoteAddress) headers.set('x-forwarded-for', req.socket.remoteAddress);
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });
  let body: Buffer | undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    body = Buffer.concat(chunks);
  }
  return new Request(`http://${req.headers.host ?? 'localhost'}${req.url}`, {
    method: req.method,
    headers,
    body: body ? new Uint8Array(body) : undefined,
    signal: controller.signal,
  });
}

async function sendWebResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    if (key !== 'set-cookie') res.setHeader(key, value);
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) res.setHeader('set-cookie', cookies);
  if (!response.body) return void res.end();
  res.flushHeaders();
  for await (const chunk of response.body) {
    if (res.destroyed) break;
    res.write(chunk);
  }
  res.end();
}

export default defineConfig({
  plugins: [
    quoApi(),
    react(),
    // Offline app shell: the service worker precaches the app, styles and
    // the wllama wasm, so Quo opens and runs with no connection (models are
    // already in OPFS). New versions install in the background and apply on
    // the next visit. The API and checkout always go to the network.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'apple-touch-icon.png'],
      // Screenshots and a description make Chrome show its richer install dialog.
      manifest: {
        id: '/',
        name: 'Quo — Private AI',
        short_name: 'Quo',
        description: 'Private AI that runs on your computer. Works offline, no account, and nothing you type leaves your device.',
        theme_color: '#3b2eff',
        background_color: '#f5f5fb',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        categories: ['productivity', 'utilities'],
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        screenshots: [
          { src: '/screenshots/chat-wide.png', sizes: '1600x1000', type: 'image/png', form_factor: 'wide', label: 'Chat privately with an AI that runs on your computer' },
          { src: '/screenshots/welcome-wide.png', sizes: '1600x1000', type: 'image/png', form_factor: 'wide', label: 'Download a model once, then it works offline' },
        ],
        shortcuts: [
          { name: 'New chat', url: '/', icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }] },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,wasm,png,svg}'],
        globIgnores: ['checkout.html', 'screenshots/**'],
        // The wllama wasm is ~9 MB.
        maximumFileSizeToCacheInBytes: 20 * 1024 * 1024,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/checkout/],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: { target: 'esnext' },
  worker: { format: 'es' },
  // wllama ships its own wasm + worker code; let it load them as-is.
  optimizeDeps: { exclude: ['@wllama/wllama'] },
  // Server-only packages stay external to the dev SSR loader.
  ssr: { external: ['postgres', '@electric-sql/pglite'] },
});
