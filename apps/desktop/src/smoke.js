'use strict';

// `npm run smoke` / QUO_SMOKE=1: loads the app in a hidden window, checks the
// capabilities local inference depends on, prints JSON and exits 0 (ok) or 1.

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const TIMEOUT_MS = 90_000;

/** A one-page PDF and a Word file saying `text`, for the document reader (agent/files/documents.js). */
function sampleDocuments(text) {
  const stream = `BT /F1 12 Tf 20 150 Td (${text}) Tj ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => {
    const at = pdf.length;
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(at => `${String(at).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const { strToU8, zipSync } = require('fflate');
  const docx = Buffer.from(zipSync({ 'word/document.xml': strToU8(`<w:document><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`) }));
  return { pdf: Buffer.from(pdf, 'latin1'), docx };
}

/** Code mode's document reader, in this build: its own locked-down process must find its code (outside the asar). */
async function checkDocuments() {
  const { reader } = require('./agent/files/documents');
  const samples = sampleDocuments('Quo smoke test');
  const read = async kind => reader.extract(kind, samples[kind]).then(text => text.includes('Quo smoke test'), error => String(error?.message ?? error));
  const result = { pdf: await read('pdf'), docx: await read('docx') };
  reader.stop();
  return result;
}

// Runs in the page. `wasmPath` is a bundled .wasm file to check its MIME type.
const probe = wasmPath => `(async () => {
  const withTimeout = (promise, ms) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
  const result = {
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
    webgpu: Boolean(navigator.gpu),
    jspi: typeof WebAssembly.Suspending === 'function',
    adapter: false,
    adapterInfo: null,
    desktop: window.quoDesktop ? { platform: window.quoDesktop.platform, version: window.quoDesktop.version, nativeEngine: Boolean(window.quoDesktop.engine), toolServers: Boolean(window.quoDesktop.toolServers), localServer: Boolean(window.quoDesktop.localServer) } : null,
    title: document.title,
    sab: typeof SharedArrayBuffer,
  };
  try {
    // Only looks for Claude Code: starts nothing and sends nothing.
    result.claude = window.quoDesktop?.claude ? await window.quoDesktop.claude.status({ check: false }) : null;
  } catch (error) {
    result.claudeError = String(error);
  }
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
    result.documents = await checkDocuments();
    // A quo:// link given to the smoke test (as Linux and Windows pass one): the page takes it and shows that model.
    const link = process.argv.find(arg => arg.startsWith('quo://'));
    if (link) {
      const name = decodeURIComponent(new URL(link).pathname.split('/').filter(Boolean).at(-1) ?? '');
      result.link = await win.webContents.executeJavaScript(`(async () => {
        const started = Date.now();
        while (Date.now() - started < 20000) {
          if (document.body.innerText.includes(${JSON.stringify(name)})) return true;
          await new Promise(resolve => setTimeout(resolve, 250));
        }
        return 'the model never appeared';
      })()`, true);
    }
    // Quo's own local pages (the approval window): they must load in this build, from the asar.
    result.approvalPage = await (async () => {
      const { BrowserWindow } = require('electron');
      const { serveLocalPage } = require('./protocol');
      const probeWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true, partition: 'smoke-approval' } });
      try {
        const base = serveLocalPage(probeWindow.webContents.session, 'approval', path.join(__dirname, 'approval'), ['approval.html', 'approval.js', 'approval.css']);
        await probeWindow.loadURL(`${base}approval.html`);
        return await probeWindow.webContents.executeJavaScript('Boolean(document.getElementById("card")) && getComputedStyle(document.body).margin !== ""');
      } catch (error) {
        return String(error?.message ?? error).slice(0, 120);
      } finally {
        probeWindow.destroy();
      }
    })();
    const ok = (result.link === undefined || result.link === true) && result.documents.pdf === true && result.documents.docx === true && result.approvalPage === true && result.desktop?.toolServers === true &&
      result.crossOriginIsolated && result.sab === 'function' && result.jspi && result.rendered && result.opfs &&
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
