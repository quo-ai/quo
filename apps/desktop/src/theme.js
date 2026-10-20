'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, ipcMain, nativeTheme } = require('electron');
const { trusted } = require('./trust');

/**
 * Light, dark or the system's choice, and how dark looks (Settings → Appearance). Setting Electron's theme makes every
 * window follow it: the app's pages (prefers-color-scheme) and the approval window, which has its own dark colours. The
 * dark style only changes the window colour behind the page. Both are kept so the window opens in the right colour, with
 * no flash of another one.
 */

const MODES = ['system', 'light', 'dark'];
const DARK_STYLES = ['black', 'midnight'];
let dark = 'black';
const file = () => path.join(app.getPath('userData'), 'theme.json');

function loadTheme() {
  try {
    const saved = JSON.parse(fs.readFileSync(file(), 'utf8'));
    if (MODES.includes(saved.mode)) nativeTheme.themeSource = saved.mode;
    if (DARK_STYLES.includes(saved.dark)) dark = saved.dark;
  } catch {
    // No choice saved yet: follow the system.
  }
}

/** onChange runs after each choice, for what nativeTheme's own event misses (a new dark style). */
function setupTheme(onChange = () => {}) {
  ipcMain.handle('app:theme', (event, payload) => {
    if (!trusted(event)) return { error: { code: 'untrusted', message: 'Not allowed.' } };
    const mode = MODES.includes(payload?.mode) ? payload.mode : 'system';
    dark = DARK_STYLES.includes(payload?.dark) ? payload.dark : 'black';
    nativeTheme.themeSource = mode;
    try {
      fs.writeFileSync(file(), JSON.stringify({ mode, dark }));
    } catch {
      // It still applies now; it just won't be remembered.
    }
    onChange();
    return { ok: true };
  });
}

/** The window colour behind the page while it loads, matching the page's own --bg (web styles/base.css, themes.css). */
const windowBackground = () => (!nativeTheme.shouldUseDarkColors ? '#f5f5fb' : dark === 'midnight' ? '#0c0c14' : '#000000');

module.exports = { loadTheme, setupTheme, windowBackground, MODES, DARK_STYLES };
