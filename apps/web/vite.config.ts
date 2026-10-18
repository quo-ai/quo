import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin, ViteDevServer } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { sendWebResponse, setIsolationHeaders, toWebRequest } from './server/node';

function isolationHeaders(req: IncomingMessage, res: ServerResponse, next: () => void) {
  setIsolationHeaders((req.url ?? '/').split('?')[0], res);
  next();
}

/**
 * Serves the API (server/routes.ts) from the dev server, so the sandbox runs
 * app + API in one process.
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

/**
 * Transformers.js's default WebAssembly runtime (27 MB) gets bundled even
 * though voice input points it at the smaller CPU build (voice/whisper.worker.ts).
 * Nothing loads the others, so they're left out.
 */
function dropUnusedSpeechRuntimes(): Plugin {
  return {
    name: 'drop-unused-speech-runtimes',
    generateBundle(_options, bundle) {
      for (const name of Object.keys(bundle)) {
        if (/ort-wasm-simd-threaded\.(asyncify|jsep|jspi)[^/]*\.(wasm|mjs)$/.test(name)) delete bundle[name];
      }
    },
  };
}

export default defineConfig({
  plugins: [
    quoApi(),
    react(),
    dropUnusedSpeechRuntimes(),
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
        // Voice input and PDF reading load on demand; they're cached when first used (below).
        globIgnores: ['checkout.html', 'screenshots/**', '**/ort-wasm-*', '**/pdf.worker*', '**/pdf-*.js'],
        runtimeCaching: [{
          urlPattern: ({ url }: { url: URL }) => /\/assets\/(ort-wasm-|pdf)/.test(url.pathname),
          handler: 'CacheFirst',
          options: { cacheName: 'quo-optional-features', expiration: { maxEntries: 12 } },
        }],
        // The wllama wasm is ~9 MB.
        maximumFileSizeToCacheInBytes: 20 * 1024 * 1024,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/checkout/],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: { target: 'esnext' },
  // The API tests start an in-memory Postgres and stream simulated replies; a shared CI runner needs more than the 5 s default.
  test: { testTimeout: 30_000, hookTimeout: 30_000 },
  worker: { format: 'es' },
  // wllama ships its own wasm + worker code; let it load them as-is.
  optimizeDeps: { exclude: ['@wllama/wllama'] },
  // Server-only packages stay external to the dev SSR loader.
  ssr: { external: ['postgres', '@electric-sql/pglite'] },
});
