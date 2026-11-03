'use strict';

// Settings → Tool servers (MCP). The page can see each server's name, state and tools, turn one on or off, ask for the
// file to be opened in the person's editor, and get the tool list to hand to a model. It can't add or change a server:
// only the file does that, and turning one on shows exactly what will run in a native dialog first.

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { trusted } = require('../trust');
const { ensureConfig } = require('./config');
const { McpManager } = require('./manager');

const broadcast = (channel, payload) => BrowserWindow.getAllWindows().forEach(window => window.webContents.send(channel, payload));

/** How a word of the command is shown in the dialog: quoted when it has spaces, so what runs is unmistakable. */
const shown = word => (/[\s"']/.test(word) || word === '' ? JSON.stringify(word) : word);

/** The native dialog before a server first runs (or runs again after its entry changed): what it runs, where, with what. */
async function confirmServer(window, entry) {
  const settings = Object.keys(entry.env);
  const detail = [
    'Quo runs this on your computer while the tool server is on, and each time Quo starts:',
    '',
    [entry.command, ...entry.args].map(shown).join(' '),
    '',
    `In the folder: ${entry.cwd ?? app.getPath('home')}`,
    ...(settings.length ? [`With these settings from the file: ${settings.join(', ')} (their values aren’t shown)`] : []),
    '',
    'A tool server can do anything a program you start can do. Turn it on only if you trust it. Quo asks before each of its tools runs.',
  ].join('\n');
  const { response } = await dialog.showMessageBox(window ?? undefined, {
    type: 'warning',
    title: 'Quo',
    message: `Turn on the tool server “${entry.name}”?`,
    detail,
    buttons: ['Turn on', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  });
  return response === 0;
}

/** @returns {McpManager} */
function setupToolServers({ ipc = ipcMain } = {}) {
  const userData = app.getPath('userData');
  const configFile = path.join(userData, 'mcp.json');
  const manager = new McpManager({ configFile, approvalsFile: path.join(userData, 'mcp-approved.json'), version: app.getVersion() });
  manager.on('changed', state => broadcast('mcp:event', state));

  const handle = (channel, task) =>
    ipc.handle(channel, async (event, payload) => {
      if (!trusted(event)) return { error: { code: 'untrusted', message: 'Not allowed.' } };
      try {
        return { ok: await task(payload ?? {}, event) };
      } catch (error) {
        console.warn(`[${channel}]`, error?.message ?? error);
        return { error: { code: 'failed', message: 'That didn’t work. Check the tool servers file.' } };
      }
    });

  handle('mcp:state', () => manager.state());
  handle('mcp:tools', () => manager.definitions());
  handle('mcp:set', ({ name, on }, event) => {
    if (typeof name !== 'string') throw new Error('bad_name');
    const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    return on === true ? manager.turnOn(name, entry => confirmServer(window, entry)) : manager.turnOff(name);
  });
  handle('mcp:reload', async () => {
    await manager.load();
    return manager.state();
  });
  // The file opens in the person's own editor; Quo makes it (empty) the first time.
  handle('mcp:edit', async () => {
    await ensureConfig(configFile);
    const failed = await shell.openPath(configFile);
    if (failed) shell.showItemInFolder(configFile);
    return true;
  });

  // An edit to the file is picked up when it is saved (editors often replace the file, so the folder is watched).
  let timer = null;
  try {
    fs.watch(userData, { persistent: false }, (_type, file) => {
      if (file !== 'mcp.json') return;
      clearTimeout(timer);
      timer = setTimeout(() => void manager.load().catch(() => {}), 400);
    });
  } catch {
    // No watching here: Reload in the settings still works.
  }

  void manager.load().catch(error => console.warn('[mcp] load', error?.message ?? error));
  app.on('will-quit', () => manager.closeAll());
  return manager;
}

module.exports = { setupToolServers, confirmServer };
