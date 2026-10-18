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

// Contract with the web app (apps/web/src/platform.ts): `platform`, `version` and
// `agent` (Code mode) always exist; `engine` and `models` exist only when this
// build includes the native llama.cpp engine, and the web app falls back to its
// in-browser engine without them. Every call resolves to { ok } or { error: { code, message } }.
contextBridge.exposeInMainWorld('quoDesktop', {
  platform: process.platform,
  version,
  // Code mode: the project folder is chosen in a native dialog and edits and commands
  // are approved in native dialogs, so none of this takes a path or an approval from the page.
  agent: {
    projects: () => invoke('agent:projects'),
    pick: () => invoke('agent:pick'),
    forget: id => invoke('agent:forget', { id }),
    start: projectId => invoke('agent:start', { projectId }),
    tool: (sessionId, name, args) => invoke('agent:tool', { sessionId, name, args }),
    abort: sessionId => invoke('agent:abort', { sessionId }),
    end: sessionId => invoke('agent:end', { sessionId }),
    clearRepos: () => invoke('agent:clear-repos'),
  },
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
