'use strict';

const crypto = require('node:crypto');
const dns = require('node:dns/promises');
const net = require('node:net');
const { WebError } = require('./errors');
const { isPublicAddress, parseWebUrl } = require('./guard');

/**
 * For a page that only fills itself in with JavaScript: load it in a hidden window of the app's own Chromium and take
 * what it shows (what a tool like Playwright would do, with no extra download). The window has no access to the app
 * or the user's data: its own empty session, no permissions, no pop-ups or downloads, no pictures or styles, and every
 * request it makes is checked like an address the model gave.
 */

const SETTLE_MS = 1500;

async function publicHost(hostname, cache) {
  const host = hostname.replace(/^\[|\]$/g, '');
  const known = cache.get(host);
  if (known && known.until > Date.now()) return known.ok;
  let ok = false;
  try {
    ok = net.isIP(host) ? isPublicAddress(host) : (await dns.lookup(host, { all: true })).every(entry => isPublicAddress(entry.address));
  } catch {
    ok = false;
  }
  cache.set(host, { ok, until: Date.now() + 60_000 });
  return ok;
}

async function renderPage(input, { timeoutMs = 20_000 } = {}) {
  const { BrowserWindow, session } = require('electron');
  const url = parseWebUrl(input);
  const ses = session.fromPartition(`quo-web-${crypto.randomUUID()}`);
  const cache = new Map();
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.on('will-download', event => event.preventDefault());
  ses.webRequest.onBeforeRequest(async (details, callback) => {
    try {
      const target = new URL(details.url);
      const wanted = /^https?:$/.test(target.protocol) && !['image', 'media', 'font', 'stylesheet'].includes(details.resourceType);
      callback({ cancel: !wanted || !(await publicHost(target.hostname, cache)) });
    } catch {
      callback({ cancel: true });
    }
  });
  const win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, images: false, backgroundThrottling: false } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new WebError('timeout', 'The page took too long to load.')), timeoutMs));
  try {
    await Promise.race([win.loadURL(url.href), timeout]);
    await new Promise(resolve => setTimeout(resolve, SETTLE_MS));
    const html = await win.webContents.executeJavaScript('document.documentElement.outerHTML');
    return { url: win.webContents.getURL() || url.href, html: String(html) };
  } catch (error) {
    throw error instanceof WebError ? error : new WebError('unreachable', `Couldn’t load ${url.hostname}.`);
  } finally {
    win.destroy();
    await ses.clearStorageData().catch(() => {});
  }
}

module.exports = { renderPage };
