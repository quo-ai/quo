'use strict';

const { app, ipcMain, net, safeStorage } = require('electron');
const path = require('node:path');
const { trusted } = require('../trust');
const { BUILT_IN } = require('./registry');
const { Endpoints } = require('./endpoints');
const { ProviderError } = require('./errors');
const { KeyStore } = require('./keystore');
const { ProviderRequests } = require('./requests');

/**
 * Connects the web app's "Your keys" to this folder. Reachable only from the app's own pages. The page can
 * save or clear a key and see its last four characters; it can't read one back, choose where one is sent,
 * or add headers: see requests.js.
 */

function setupProviders() {
  const userData = app.getPath('userData');
  const keys = new KeyStore({ file: path.join(userData, 'provider-keys.json'), safeStorage });
  const endpoints = new Endpoints(path.join(userData, 'provider-endpoints.json'));
  const requests = new ProviderRequests({ keys, endpoints, fetchFn: (url, init) => net.fetch(url, init) });
  const owners = new Map(); // request id -> the window that started it

  const handle = (channel, task) =>
    ipcMain.handle(channel, async (event, payload) => {
      if (!trusted(event)) return { error: { code: 'untrusted', message: 'Not allowed.' } };
      try {
        return { ok: await task(payload ?? {}, event) };
      } catch (error) {
        if (error instanceof ProviderError) return { error: { code: error.code, message: error.message } };
        console.warn(`[${channel}]`, error.message);
        return { error: { code: 'failed', message: 'Something went wrong.' } };
      }
    });

  /** Only ids of providers that exist can hold a key. */
  async function known(id) {
    const provider = String(id ?? '');
    if (!(provider in BUILT_IN) && !(await endpoints.get(provider))) throw new ProviderError('unknown_provider', 'That provider isn’t set up.');
    return provider;
  }

  handle('providers:list', async () => {
    const custom = await endpoints.list();
    return { keys: await keys.states([...Object.keys(BUILT_IN), ...custom.map(e => e.id)]), custom, secure: keys.secure };
  });

  handle('providers:set-key', async ({ id, key }) => keys.set(await known(id), key));
  handle('providers:clear-key', async ({ id }) => keys.clear(await known(id)));

  handle('providers:save-custom', async ({ id, name, baseUrl, protocol, key }) => {
    const { entry, changed } = await endpoints.save({ id, name, baseUrl, protocol });
    // A key belongs to one address: pointing the server somewhere else must not carry it along.
    if (changed) await keys.clear(entry.id);
    if (key) await keys.set(entry.id, key);
    return entry;
  });

  handle('providers:remove-custom', async ({ id }) => {
    const provider = await known(id);
    if (provider in BUILT_IN) throw new ProviderError('unknown_provider', 'That provider can’t be removed.');
    await keys.clear(provider);
    await endpoints.remove(provider);
  });

  handle('providers:request', async (request, event) => {
    const sender = event.sender;
    const emit = message => {
      if (message.type === 'end' || message.type === 'error') owners.delete(message.id);
      if (!sender.isDestroyed()) sender.send('providers:event', message);
    };
    owners.set(String(request?.id), sender.id);
    try {
      await requests.start(request, emit);
    } catch (error) {
      owners.delete(String(request?.id));
      throw error;
    }
  });

  handle('providers:abort', ({ id }, event) => {
    if (owners.get(String(id)) === event.sender.id) requests.abort(String(id));
  });

  app.on('will-quit', () => requests.abortAll());
  return { requests, keys };
}

module.exports = { setupProviders };
