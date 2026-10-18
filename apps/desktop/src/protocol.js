'use strict';

// Serves the bundled web app from app://quo/ and proxies /api/* to the hosted
// backend, so the web app runs unchanged (relative /api URLs, same origin).

const fs = require('node:fs/promises');
const path = require('node:path');
const { protocol, net } = require('electron');

const APP_SCHEME = 'app';
const APP_HOST = 'quo';
const APP_URL = `${APP_SCHEME}://${APP_HOST}/`;
const API_ORIGIN = new URL(process.env.QUO_API_ORIGIN || 'https://quoai-app.vercel.app').origin;

// Cross-origin isolation: enables SharedArrayBuffer (multithreaded wasm).
const ISOLATION_HEADERS = {
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-embedder-policy': 'require-corp',
  'cross-origin-resource-policy': 'same-origin',
};

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

// Same shape as the API's own errors ({ error: code, message }), so the web
// app shows its normal offline state.
const OFFLINE_BODY = JSON.stringify({ error: 'offline', message: "You're offline. Offline models still work." });

// Request headers that describe the renderer (app://quo), not this proxy.
// Forwarding Origin would make Chromium treat the call as cross-site: no
// cookies, and the API's CSRF guard (Sec-Fetch-Site) would reject POSTs.
const DROP_REQUEST_HEADERS = ['host', 'origin', 'referer', 'cookie', 'connection', 'content-length', 'accept-encoding', 'user-agent'];
// Cookies stay in the session's cookie jar; the body is already decoded.
const DROP_RESPONSE_HEADERS = ['set-cookie', 'content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive'];
const UPSTREAM_HEADERS_TIMEOUT_MS = 30_000;

/** Must run before the app is ready. */
function registerScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, codeCache: true },
    },
  ]);
}

function handleAppProtocol(ses, webRoot) {
  const root = path.resolve(webRoot);
  ses.protocol.handle(APP_SCHEME, async request => {
    try {
      return await route(request, root);
    } catch (error) {
      console.error('[app://]', request.method, request.url, error);
      return respond(500, 'Internal error', MIME_TYPES['.txt']);
    }
  });
}

async function route(request, root) {
  const url = new URL(request.url);
  if (url.host !== APP_HOST) return notFound();
  if (url.pathname.startsWith('/api/')) return proxyApi(request, url);
  if (url.pathname.startsWith('/engine/')) return proxyEngine(request, url);
  // No service worker in the desktop app: assets ship with it.
  if (url.pathname === '/registerSW.js') return respond(200, '', MIME_TYPES['.js']);
  if (url.pathname === '/sw.js') return notFound();
  return serveFile(request, url, root);
}

async function serveFile(request, url, root) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return respond(405, 'Method not allowed', MIME_TYPES['.txt']);

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return respond(400, 'Bad request', MIME_TYPES['.txt']);
  }
  let file = path.resolve(root, `.${pathname}`);
  if (pathname.includes('\0') || (file !== root && !file.startsWith(root + path.sep))) {
    return notFound();
  }

  let stat = await fs.stat(file).catch(() => null);
  if (stat?.isDirectory()) {
    file = path.join(file, 'index.html');
    stat = await fs.stat(file).catch(() => null);
  }
  if (!stat?.isFile()) {
    // Client-side routes (no extension) get the app shell; missing assets 404.
    if (path.extname(pathname)) return notFound();
    file = path.join(root, 'index.html');
  }

  const type = MIME_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  const body = request.method === 'HEAD' ? null : await fs.readFile(file);
  return respond(200, body, type, { 'cache-control': 'no-cache' });
}

// Where the running llama-server listens (set by main.js); null with no model loaded.
let engineTarget = () => null;
function setEngineTarget(provider) {
  engineTarget = provider;
}

const ENGINE_IDLE_BODY = JSON.stringify({ error: 'engine_not_running', message: 'No model is loaded.' });

/**
 * Chat with the local model: the page POSTs to /engine/v1/chat/completions and
 * this forwards it to llama-server on 127.0.0.1 with the key only the main
 * process knows. Nothing else of the server is reachable from the page.
 */
async function proxyEngine(request, url) {
  if (request.method !== 'POST' || url.pathname !== '/engine/v1/chat/completions') return notFound();
  const target = engineTarget();
  if (!target) return respond(503, ENGINE_IDLE_BODY, 'application/json; charset=utf-8', { 'cache-control': 'no-store' });

  const body = await request.arrayBuffer();
  const controller = new AbortController();
  let upstream;
  try {
    // Node's fetch, not the session's: no proxy settings apply to loopback.
    upstream = await fetch(`${target.origin}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${target.key}` },
      body,
      signal: controller.signal,
    });
  } catch {
    return respond(503, ENGINE_IDLE_BODY, 'application/json; charset=utf-8', { 'cache-control': 'no-store' });
  }
  const headers = new Headers({ 'content-type': upstream.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  for (const [name, value] of Object.entries(ISOLATION_HEADERS)) headers.set(name, value);
  return new Response(passThrough(upstream, controller), { status: upstream.status, headers });
}

/**
 * Re-wraps a response body so a cancelled read in the renderer (stopping a
 * streamed reply) also aborts the upstream request. Chunks pass straight
 * through, so server-sent events are not buffered.
 */
function passThrough(upstream, controller) {
  if (!upstream.body) return null;
  const reader = upstream.body.getReader();
  return new ReadableStream({
    async pull(stream) {
      const { done, value } = await reader.read();
      if (done) stream.close();
      else stream.enqueue(value);
    },
    cancel(reason) {
      controller.abort(reason);
    },
  });
}

async function proxyApi(request, url) {
  const headers = new Headers(request.headers);
  for (const name of [...headers.keys()]) {
    if (DROP_REQUEST_HEADERS.includes(name) || name.startsWith('sec-fetch-')) headers.delete(name);
  }
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const body = hasBody ? await request.arrayBuffer() : null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_HEADERS_TIMEOUT_MS);
  let upstream;
  try {
    upstream = await net.fetch(new URL(url.pathname + url.search, API_ORIGIN).href, {
      method: request.method,
      headers,
      body: body?.byteLength ? body : null,
      // Sends and stores the API's cookies in this session's persistent jar.
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal,
    });
  } catch (error) {
    console.warn('[api] unreachable:', request.method, url.pathname, error?.message ?? error);
    return respond(503, OFFLINE_BODY, 'application/json; charset=utf-8', { 'cache-control': 'no-store' });
  } finally {
    clearTimeout(timeout);
  }

  const responseHeaders = new Headers(upstream.headers);
  for (const name of DROP_RESPONSE_HEADERS) responseHeaders.delete(name);
  for (const [name, value] of Object.entries(ISOLATION_HEADERS)) responseHeaders.set(name, value);

  return new Response(passThrough(upstream, controller), { status: upstream.status, statusText: upstream.statusText, headers: responseHeaders });
}

const notFound = () => respond(404, 'Not found', MIME_TYPES['.txt']);

function respond(status, body, contentType, extraHeaders = {}) {
  return new Response(body, {
    status,
    headers: { 'content-type': contentType, 'x-content-type-options': 'nosniff', ...ISOLATION_HEADERS, ...extraHeaders },
  });
}

module.exports = { APP_SCHEME, APP_HOST, APP_URL, API_ORIGIN, registerScheme, handleAppProtocol, setEngineTarget };
