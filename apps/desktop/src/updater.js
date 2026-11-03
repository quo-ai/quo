'use strict';

// Auto-update from GitHub Releases (electron-updater reads the latest*.yml
// files electron-builder publishes). Failures, e.g. offline, are only logged.
// The check is the one thing Quo contacts by itself at start-up, so the person can
// turn it off: Help → Check for Updates at Start-up (saved in updates.json).
//
// macOS installs an update only into an app with a Developer ID signature (Squirrel.Mac). The Mac app is ad-hoc signed
// (no paid Apple membership), so there it downloads nothing: it says once per version that a new Quo is out, with a
// button to the download page (or run the install command again).

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { app, BrowserWindow, dialog, shell } = require('electron');

const DOWNLOAD_PAGE = 'https://quo.computer/#desktop';

const prefsFile = dir => path.join(dir ?? app.getPath('userData'), 'updates.json');

const readPrefs = dir => {
  try {
    const prefs = JSON.parse(fs.readFileSync(prefsFile(dir), 'utf8'));
    return prefs && typeof prefs === 'object' ? prefs : {};
  } catch {
    return {};
  }
};
const writePrefs = (patch, dir) => fs.writeFileSync(prefsFile(dir), JSON.stringify({ ...readPrefs(dir), ...patch }));

/** Whether Quo checks for a new version when it starts: yes, unless the person turned it off. */
function readUpdateChecks(dir) {
  return readPrefs(dir).check !== false;
}

function writeUpdateChecks(on, dir) {
  writePrefs({ check: on === true }, dir);
}

/** The newest version the person was already told about (Macs that can't update themselves), so it's said once. */
const toldAbout = dir => (typeof readPrefs(dir).told === 'string' ? readPrefs(dir).told : null);
const rememberTold = (version, dir) => writePrefs({ told: version }, dir);

/** Whether codesign's description of the app shows a Developer ID signature, the only kind Squirrel.Mac updates. */
const hasDeveloperId = description => /^Authority=Developer ID Application:/m.test(String(description ?? ''));

/** Whether this build can install its own updates: everywhere but on a Mac without a Developer ID signature. */
function canSelfUpdate() {
  if (process.platform !== 'darwin') return Promise.resolve(true);
  const bundle = path.resolve(process.execPath, '..', '..', '..'); // …/Quo.app/Contents/MacOS/Quo
  return new Promise(resolve => {
    execFile('codesign', ['-dv', '--verbose=2', bundle], { timeout: 10_000 }, (error, _stdout, stderr) => resolve(!error && hasDeveloperId(stderr)));
  });
}

async function tellAboutUpdate(info) {
  if (!info?.version || toldAbout() === info.version) return;
  rememberTold(info.version);
  const options = {
    type: 'info',
    buttons: ['Download', 'Later'],
    defaultId: 0,
    cancelId: 1,
    message: `Quo ${info.version} is out.`,
    detail: 'This Mac version can’t update itself yet. Download the new version, or run the install command again: curl -fsSL https://quo.computer/install.sh | sh. Your chats and models are kept.',
  };
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
  if (response === 0) await shell.openExternal(DOWNLOAD_PAGE);
}

const warn = error => console.warn('[updater]', String(error?.message ?? error).split('\n')[0]);

async function initAutoUpdates() {
  if (!app.isPackaged || process.env.QUO_DISABLE_UPDATES === '1' || !readUpdateChecks()) return;
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.logger = null;
    const selfUpdate = await canSelfUpdate();
    autoUpdater.autoDownload = selfUpdate;
    if (!selfUpdate) autoUpdater.once('update-available', info => tellAboutUpdate(info).catch(warn));
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

module.exports = { initAutoUpdates, readUpdateChecks, writeUpdateChecks, hasDeveloperId, toldAbout, rememberTold };
