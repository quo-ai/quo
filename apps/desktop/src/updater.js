'use strict';

// Auto-update from GitHub Releases (electron-updater reads the latest*.yml
// files electron-builder publishes). Failures, e.g. offline, are only logged.
// The check is the one thing Quo contacts by itself at start-up, so the person can
// turn it off: Help → Check for Updates at Start-up (saved in updates.json).

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, dialog } = require('electron');

const prefsFile = dir => path.join(dir ?? app.getPath('userData'), 'updates.json');

/** Whether Quo checks for a new version when it starts: yes, unless the person turned it off. */
function readUpdateChecks(dir) {
  try {
    return JSON.parse(fs.readFileSync(prefsFile(dir), 'utf8')).check !== false;
  } catch {
    return true;
  }
}

function writeUpdateChecks(on, dir) {
  fs.writeFileSync(prefsFile(dir), JSON.stringify({ check: on === true }));
}

const warn = error => console.warn('[updater]', String(error?.message ?? error).split('\n')[0]);

function initAutoUpdates() {
  if (!app.isPackaged || process.env.QUO_DISABLE_UPDATES === '1' || !readUpdateChecks()) return;
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.logger = null;
    autoUpdater.autoDownload = true;
    // "Later" still installs the update the next time Quo quits.
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('error', warn);
    autoUpdater.once('update-downloaded', async info => {
      try {
        const options = {
          type: 'info',
          buttons: ['Restart', 'Later'],
          defaultId: 0,
          cancelId: 1,
          message: 'A new version of Quo is ready. Restart to update?',
          detail: `Quo ${info.version} has been downloaded.`,
        };
        const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
        const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
        if (response === 0) autoUpdater.quitAndInstall();
      } catch (error) {
        warn(error);
      }
    });
    // Failed checks are reported through the 'error' event above.
    autoUpdater.checkForUpdates().catch(() => {});
  } catch (error) {
    warn(error);
  }
}

module.exports = { initAutoUpdates, readUpdateChecks, writeUpdateChecks };
