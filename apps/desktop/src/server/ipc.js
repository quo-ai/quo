'use strict';

// The local server for other apps (localApi.js), for the app's own pages only. Turning it on is asked about in a native
// dialog the page can't draw or click; turning it off, a new key or another port are not.

const { BrowserWindow, dialog, ipcMain } = require('electron');
const { trusted } = require('../trust');
const { LocalApi } = require('./localApi');

function setupLocalApi({ settingsFile, engine, ipc = ipcMain, confirm = null }) {
  const api = new LocalApi({ settingsFile, target: () => engine.target(), status: () => engine.status(), activity: { started: () => engine.requestStarted(), ended: () => engine.requestEnded() } });
  const ask = confirm ?? (async sender => {
    const window = BrowserWindow.fromWebContents(sender) ?? undefined;
    const { response } = await dialog.showMessageBox(window, {
      type: 'question',
      title: 'Quo',
      message: 'Let other apps on this computer use Quo’s models?',
      detail: 'Quo starts a server at 127.0.0.1 that answers the OpenAI-style API with the model Quo has loaded. Only apps on this computer that have the key can use it; web pages and other computers can’t reach it. Turn it off at any time.',
      buttons: ['Turn on', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    }).catch(() => ({ response: 1 }));
    return response === 0;
  });
  const handle = (channel, task) => ipc.handle(channel, async (event, payload) => {
    if (!trusted(event)) return { error: { code: 'untrusted', message: 'Not allowed.' } };
    try {
      return { ok: await task(payload ?? {}, event) };
    } catch (error) {
      const code = error?.code === 'EADDRINUSE' ? 'port_in_use' : error?.message === 'bad_port' ? 'bad_port' : 'failed';
      const message = code === 'port_in_use' ? 'Another app is using that port. Choose another one.' : code === 'bad_port' ? 'Choose a port from 1024 to 65535.' : 'The local server couldn’t start.';
      return { error: { code, message } };
    }
  });
  handle('localapi:state', () => api.state());
  handle('localapi:set', async ({ on }, event) => {
    if (on !== true) return api.stop();
    if (api.state().on) return api.state();
    return (await ask(event.sender)) ? api.start() : api.state();
  });
  handle('localapi:renew-key', () => api.renewKey());
  handle('localapi:port', ({ port }) => api.setPort(Number(port)));
  // On again after a restart, if the person left it on.
  if (api.saved.on) api.start().catch(error => console.warn('[local api]', error.message));
  return api;
}

module.exports = { setupLocalApi };
