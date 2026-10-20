'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, ipcMain, nativeTheme } = require('electron');
const { trusted } = require('./trust');

/**
 * Light, dark or the system's choice (Settings → Appearance). Setting Electron's theme makes every window follow it:
 * the app's pages (prefers-color-scheme) and the approval window, which has its own dark colours. The choice is kept so
 * the window opens in the right colour, with no flash of the other one.
 */

const MODES = ['system', 'light', 'dark'];
const file = () => path.join(app.getPath('userData'), 'theme.json');

function loadTheme() {
  try {
    const mode = JSON.parse(fs.readFileSync(file(), 'utf8')).mode;
    if (MODES.includes(mode)) nativeTheme.themeSource = mode;
  } catch {
    // No choice saved yet: follow the system.
  }
}

function setupTheme() {
  ipcMain.handle('app:theme', (event, payload) => {
    if (!trusted(event)) return { error: { code: 'untrusted', message: 'Not allowed.' } };
    const mode = MODES.includes(payload?.mode) ? payload.mode : 'system';
    nativeTheme.themeSource = mode;
    try {
      fs.writeFileSync(file(), JSON.stringify({ mode }));
    } catch {
      // It still applies now; it just won't be remembered.
    }
    return { ok: true };
  });
}

/** The window colour behind the page while it loads, matching the page's own background (styles/base.css --bg). */
const windowBackground = () => (nativeTheme.shouldUseDarkColors ? '#0c0c14' : '#f5f5fb');

module.exports = { loadTheme, setupTheme, windowBackground, MODES };
