'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, ipcMain, nativeTheme } = require('electron');
const { trusted } = require('./trust');

/**
 * The mode (light, dark or the system's) and the appearance the page resolved from Settings → Appearance (web theme.ts).
 * Setting Electron's theme makes every window follow the mode: the app's pages (prefers-color-scheme) and the approval
 * window, which has its own light and dark colours. The appearance sets the window colour behind the page. Both are kept
 * so the window opens in the right colour, with no flash of another one.
 */

const MODES = ['system', 'light', 'dark'];
const LOOKS = ['light', 'dark', 'black', 'contrast', 'contrast-dark', 'eink'];
// Each appearance's page colour (--ground in web styles/tokens.css; a web test compares them).
const GROUNDS = { 'light': '#f9fafd', 'dark': '#0d0f16', 'black': '#000000', 'contrast': '#ffffff', 'contrast-dark': '#05050a', 'eink': '#ffffff' };
let look = null;
const file = () => path.join(app.getPath('userData'), 'theme.json');

function loadTheme() {
  try {
    const saved = JSON.parse(fs.readFileSync(file(), 'utf8'));
    if (MODES.includes(saved.mode)) nativeTheme.themeSource = saved.mode;
    if (LOOKS.includes(saved.look)) look = saved.look;
  } catch {
    // No choice saved yet: follow the system.
  }
}

/** onChange runs after each choice, for what nativeTheme's own event misses (a new appearance in the same mode). */
function setupTheme(onChange = () => {}) {
  ipcMain.handle('app:theme', (event, payload) => {
    if (!trusted(event)) return { error: { code: 'untrusted', message: 'Not allowed.' } };
    const mode = MODES.includes(payload?.mode) ? payload.mode : 'system';
    look = LOOKS.includes(payload?.look) ? payload.look : null;
    nativeTheme.themeSource = mode;
    try {
      fs.writeFileSync(file(), JSON.stringify({ mode, look }));
    } catch {
      // It still applies now; it just won't be remembered.
    }
    onChange();
    return { ok: true };
  });
}

/** The window colour behind the page while it loads: the page's own, or Light or Dark until the page has said. */
const windowBackground = () => GROUNDS[look ?? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light')];

module.exports = { loadTheme, setupTheme, windowBackground, MODES, LOOKS, GROUNDS };
