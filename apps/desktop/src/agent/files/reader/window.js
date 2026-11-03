'use strict';

// The document reader in the app: a hidden window, sandboxed like a web page (no Node, the operating system's renderer
// sandbox), in a session of its own that can load nothing but Quo's own files and is refused every permission. It gets
// each document as bytes from main and answers with its text (reader.mjs, preload.js). A document that tries to exploit
// the PDF or zip reader lands there, not in the main process that holds the person's keys.

const path = require('node:path');
const { BrowserWindow, ipcMain, session } = require('electron');
const { serveLocalPage } = require('../../../protocol');

const PARTITION = 'quo-documents';
const HOST = 'documents';
const START_MS = 20_000;
// The only files the reader's session serves (protocol.js), from Quo's own folder.
const FILES = [
  'src/agent/files/reader/reader.html',
  'src/agent/files/reader/reader.mjs',
  'src/agent/files/reader/extract.mjs',
  'node_modules/fflate/esm/browser.js',
  'node_modules/pdfjs-dist/legacy/build/pdf.mjs',
  'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
];
let guarded = false;

/** The reader's session: its own few files only (no network, nothing else on disk), every permission refused. */
function guard(ses) {
  const base = serveLocalPage(ses, HOST, path.resolve(__dirname, '..', '..', '..', '..'), FILES);
  if (guarded) return base;
  guarded = true;
  ses.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith(base) }));
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  return base;
}

class WindowTransport {
  /** @param {{ onReply: (id: number, result: { text?: string, error?: string }) => void, onGone: (reason: string) => void }} hooks */
  constructor({ onReply, onGone }) {
    this.onReply = onReply;
    this.onGone = onGone;
    this.window = null;
    this.ready = null;
    // Answers count only from the reader's own window, never from another page.
    ipcMain.on('documents:reply', (event, id, result) => {
      if (this.window && !this.window.isDestroyed() && event.sender === this.window.webContents) this.onReply(Number(id), result ?? {});
    });
  }

  start() {
    const ses = session.fromPartition(PARTITION);
    const base = guard(ses);
    const window = new BrowserWindow({
      show: false,
      width: 100,
      height: 100,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInWorker: false, webviewTag: false, session: ses, preload: path.join(__dirname, 'preload.js'), spellcheck: false, backgroundThrottling: false, images: false, webgl: false },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    const gone = reason => {
      if (this.window !== window) return;
      this.window = null;
      this.ready = null;
      this.onGone(reason);
    };
    window.webContents.on('render-process-gone', () => gone('The document reader stopped.'));
    window.on('closed', () => gone('The document reader stopped.'));
    this.window = window;
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The document reader didn’t start.')), START_MS);
      const onReady = event => {
        if (event.sender !== window.webContents) return;
        ipcMain.removeListener('documents:ready', onReady);
        clearTimeout(timer);
        resolve();
      };
      ipcMain.on('documents:ready', onReady);
      window.loadURL(`${base}src/agent/files/reader/reader.html`).catch(error => {
        clearTimeout(timer);
        reject(error);
      });
    });
    return this.ready;
  }

  async send(id, kind, bytes) {
    if (!this.window) this.start();
    await this.ready;
    this.window?.webContents.send('documents:request', { id, kind, bytes: new Uint8Array(bytes) });
  }

  get running() {
    return Boolean(this.window);
  }

  stop() {
    const window = this.window;
    this.window = null;
    this.ready = null;
    if (window && !window.isDestroyed()) window.destroy();
  }
}

module.exports = { WindowTransport, PARTITION };
