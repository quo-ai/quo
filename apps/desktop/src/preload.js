'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Passed in by the main process (webPreferences.additionalArguments):
// sandboxed preloads can't read package.json or probe the disk.
const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const version = arg('quo-version') ?? '';
const hasEngine = arg('quo-engine') === '1';

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);
function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

// Contract with the web app (apps/web/src/platform.ts): `platform` and `version`
// always exist; `engine` and `models` exist only when this build includes the
// native llama.cpp engine, and the web app falls back to its in-browser engine
// without them. Every call resolves to { ok } or { error: { code, message } }.
contextBridge.exposeInMainWorld('quoDesktop', {
  platform: process.platform,
  version,
  ...(hasEngine && {
    engine: {
      info: () => invoke('engine:info'),
      status: () => invoke('engine:status'),
      start: options => invoke('engine:start', options),
      stop: () => invoke('engine:stop'),
      onEvent: callback => subscribe('engine:event', callback),
    },
    models: {
      state: (modelId, files) => invoke('models:state', { modelId, files }),
      download: (modelId, files) => invoke('models:download', { modelId, files }),
      cancel: modelId => invoke('models:cancel', { modelId }),
      remove: modelId => invoke('models:remove', { modelId }),
      reveal: () => invoke('models:reveal'),
      onEvent: callback => subscribe('models:event', callback),
      custom: {
        list: () => invoke('models:custom:list'),
        scan: () => invoke('models:custom:scan'),
        add: (path, options) => invoke('models:custom:add', { path, ...options }),
        pick: () => invoke('models:custom:pick'),
        remove: id => invoke('models:custom:remove', { id }),
      },
    },
  }),
});
