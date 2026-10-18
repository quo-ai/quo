'use strict';

// `npm run smoke` / QUO_SMOKE=1: loads the app in a hidden window, checks the
// capabilities local inference depends on, prints JSON and exits 0 (ok) or 1.

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const TIMEOUT_MS = 90_000;

// Runs in the page. `wasmPath` is a bundled .wasm file to check its MIME type.
const probe = wasmPath => `(async () => {
  const withTimeout = (promise, ms) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
  const result = {
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
    webgpu: Boolean(navigator.gpu),
    jspi: typeof WebAssembly.Suspending === 'function',
    adapter: false,
    adapterInfo: null,
    desktop: window.quoDesktop ? { platform: window.quoDesktop.platform, version: window.quoDesktop.version, nativeEngine: Boolean(window.quoDesktop.engine) } : null,
    title: document.title,
    sab: typeof SharedArrayBuffer,
  };
  try {
    result.engine = window.quoDesktop?.engine ? await window.quoDesktop.engine.info() : null;
  } catch (error) {
    result.engineError = String(error);
  }
  try {
    const adapter = navigator.gpu ? await withTimeout(navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }), 15000) : null;
    result.adapter = Boolean(adapter);
    if (adapter?.info) {
      const { vendor, architecture, description, isFallbackAdapter } = adapter.info;
      result.adapterInfo = { vendor, architecture, description, isFallbackAdapter };
    }
  } catch (error) {
    result.adapterError = String(error);
  }
  // The React app mounted, i.e. its module scripts loaded.
  const started = Date.now();
  while (!document.getElementById('root')?.childElementCount && Date.now() - started < 15000) await new Promise(r => setTimeout(r, 100));
  result.rendered = Boolean(document.getElementById('root')?.childElementCount);
  try {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle('.quo-smoke', { create: true });
    await root.removeEntry(handle.name);
    result.opfs = true;
  } catch (error) {
    result.opfs = false;
    result.opfsError = String(error);
  }
  const { quota } = await navigator.storage.estimate();
  result.storage = { persisted: await navigator.storage.persist(), quotaGB: Math.round(quota / 1e9) };
  result.wasmType = ${JSON.stringify(wasmPath)} ? (await fetch(${JSON.stringify(wasmPath)}, { method: 'HEAD' })).headers.get('content-type') : null;
  result.serviceWorkerScript = (await fetch('/sw.js')).status;
  try {
    const response = await fetch('/api/models', { headers: { 'x-quo-device': 'smoke-test' }, signal: AbortSignal.timeout(40000) });
    result.api = { status: response.status, contentType: response.headers.get('content-type'), body: (await response.text()).slice(0, 160) };
  } catch (error) {
    result.api = { error: String(error) };
  }
  result.userAgent = navigator.userAgent;
  return result;
})()`;

async function runSmoke(createWindow, webRoot) {
  const finish = (result, ok) => {
    process.stdout.write(`${JSON.stringify({ ok, ...result }, null, 2)}\n`);
    app.exit(ok ? 0 : 1);
  };
  setTimeout(() => finish({ error: 'timed out' }, false), TIMEOUT_MS).unref();

  try {
    const assets = path.join(webRoot, 'assets');
    const wasm = fs.existsSync(assets) ? fs.readdirSync(assets).find(name => name.endsWith('.wasm')) : null;

    const win = createWindow({ hidden: true });
    const loaded = new Promise((resolve, reject) => {
      win.webContents.once('did-finish-load', resolve);
      win.webContents.once('did-fail-load', (_event, code, description) => reject(new Error(`load failed: ${code} ${description}`)));
    });
    await loaded;
    const result = await win.webContents.executeJavaScript(probe(wasm ? `/assets/${wasm}` : null), true);
    const ok = result.crossOriginIsolated && result.sab === 'function' && result.jspi && result.rendered && result.opfs &&
      /Quo/.test(result.title) &&
      result.desktop?.platform === process.platform && result.desktop?.version === app.getVersion() &&
      (!wasm || result.wasmType === 'application/wasm') &&
      typeof result.api?.status === 'number' &&
      // QUO_EXPECT_ENGINE=1: this build must include the native engine.
      (process.env.QUO_EXPECT_ENGINE !== '1' || result.engine?.ok?.available === true);
    finish(result, ok);
  } catch (error) {
    finish({ error: String(error?.stack ?? error) }, false);
  }
}

module.exports = { runSmoke };
