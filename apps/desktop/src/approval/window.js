'use strict';

const path = require('node:path');
const { BrowserWindow, app, ipcMain } = require('electron');
const { normalizeChoice, shapeRequest } = require('./request');

/**
 * Asks the person to approve something in a small window of Quo's own, drawn in the app's style. It is not the page:
 * it is a separate window made by the main process, with its own isolated renderer (no node, a content policy that allows
 * no inline script or remote content, nothing but a preload that can say "answer" and "height"). The page can't reach
 * it, click it, or answer for it; the answer is taken only from that window's own contents; closing it means no. That is
 * what the plain system dialog gave, with room for a coloured diff and a readable command or commit.
 *
 * One at a time. When a request can't be drawn or the window can't be made, the caller uses the plain dialog.
 */

const WIDTH = 620;
const MIN_HEIGHT = 230;
const active = new Map(); // webContents id -> { request, settle }
let queue = Promise.resolve();
let registered = false;

function register() {
  if (registered) return;
  registered = true;
  ipcMain.on('approval:answer', (event, choice) => {
    const entry = active.get(event.sender.id); // only from a window we made, and only for the request it was given
    if (entry) entry.settle(normalizeChoice(entry.request, choice));
  });
  ipcMain.on('approval:resize', (event, height) => {
    const entry = active.get(event.sender.id);
    if (!entry || !Number.isFinite(height) || height <= 0) return;
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || window.isDestroyed()) return;
    const parent = window.getParentWindow();
    const room = parent ? parent.getBounds().height - 40 : 800;
    const next = Math.max(MIN_HEIGHT, Math.min(Math.ceil(height) + 6, Math.max(MIN_HEIGHT, room)));
    const bounds = window.getBounds();
    window.setBounds({ ...bounds, y: parent ? Math.round(parent.getBounds().y + (parent.getBounds().height - next) / 2) : bounds.y, height: next });
  });
}

function show(parent, request) {
  return new Promise((resolve, reject) => {
    const shaped = shapeRequest(request);
    if (!shaped) return reject(new Error('not drawable'));
    register();
    let done = false;
    let window;
    let contentsId = null; // read once: a destroyed window no longer lets us ask
    const settle = answer => {
      if (done) return;
      done = true;
      active.delete(contentsId);
      try {
        if (window && !window.isDestroyed()) window.destroy();
      } catch {
        // Already gone.
      }
      resolve(answer);
    };
    try {
      const bounds = parent && !parent.isDestroyed() ? parent.getBounds() : null;
      window = new BrowserWindow({
        parent: bounds ? parent : undefined,
        modal: Boolean(bounds),
        width: WIDTH,
        height: MIN_HEIGHT + 120,
        x: bounds ? Math.round(bounds.x + (bounds.width - WIDTH) / 2) : undefined,
        y: bounds ? Math.round(bounds.y + (bounds.height - (MIN_HEIGHT + 120)) / 2) : undefined,
        show: false,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        hasShadow: false,
        resizable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        title: 'Quo Code',
        webPreferences: { preload: path.join(__dirname, 'preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false, spellcheck: false, partition: 'approval' },
      });
    } catch (error) {
      return reject(error);
    }
    const contents = window.webContents;
    contentsId = contents.id;
    active.set(contentsId, { request: shaped, settle });
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', event => event.preventDefault());
    contents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    contents.once('did-finish-load', () => {
      if (done || window.isDestroyed()) return;
      contents.send('approval:show', shaped);
      window.show();
      window.focus();
    });
    contents.once('did-fail-load', () => {
      if (!done) {
        done = true;
        active.delete(contentsId);
        try {
          window.destroy();
        } catch {
          // Already gone.
        }
        reject(new Error('approval window failed to load'));
      }
    });
    window.once('closed', () => settle('deny')); // closing it is a no
    app.once('before-quit', () => settle('deny'));
    window.loadFile(path.join(__dirname, 'approval.html')).catch(() => {});
  });
}

/** Resolves to 'once', 'session' or 'deny'; rejects if the window can't be used (the caller then uses the plain dialog). */
function askInApp(parent, request) {
  const run = queue.then(() => show(parent, request), () => show(parent, request));
  queue = run.catch(() => {});
  return run;
}

module.exports = { askInApp };
