'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Passed in by the main process (webPreferences.additionalArguments):
// sandboxed preloads can't read package.json or probe the disk.
const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const version = arg('quo-version') ?? '';
const hasEngine = arg('quo-engine') === '1';
const hasImages = arg('quo-images') === '1';
// Claude Agent: development builds only, until Anthropic approves it for releases (src/claude/release.js).
const hasClaude = arg('quo-claude') === '1';

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);
function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

// Contract with the web app (apps/web/src/platform.ts): `platform`, `version` and
// `agent` (Code mode) and `providers` (the user's own API keys) always exist; `claude` (Claude Agent) only where it's offered; `engine` and `models` exist only when this
// build includes the native llama.cpp engine, and the web app falls back to its
// in-browser engine without them. Every call resolves to { ok } or { error: { code, message } }.
contextBridge.exposeInMainWorld('quoDesktop', {
  platform: process.platform,
  version,
  // Light, dark or the system's: every window follows it, the approval window too.
  appearance: { set: (mode, look) => invoke('app:theme', { mode, look }) },
  // Tool servers (MCP, mcp/): added only in the person's own file; turning one on shows what it runs in a native dialog,
  // and each tool call is approved in Quo's approval window. The page sees names, states and tools, never a command.
  toolServers: {
    state: () => invoke('mcp:state'),
    tools: () => invoke('mcp:tools'),
    set: (name, on) => invoke('mcp:set', { name: String(name), on: on === true }),
    reload: () => invoke('mcp:reload'),
    edit: () => invoke('mcp:edit'),
    call: (chatId, name, args) => invoke('mcp:call', { chatId: String(chatId), name: String(name), args }),
    abort: chatId => invoke('mcp:abort', { chatId: String(chatId) }),
    onEvent: callback => subscribe('mcp:event', callback),
  },
  // Code mode: the project folder is chosen in a native dialog and edits and commands
  // are approved in native dialogs, so none of this takes a path or an approval from the page.
  agent: {
    projects: () => invoke('agent:projects'),
    pick: () => invoke('agent:pick'),
    workspace: name => invoke('agent:workspace', { name }),
    forget: id => invoke('agent:forget', { id }),
    start: (projectId, options) => invoke('agent:start', { projectId, autoReadOnly: options?.autoReadOnly, compact: options?.compact, creditQuo: options?.creditQuo, allowPush: options?.allowPush, confirm: options?.confirm }),
    tool: (sessionId, name, args) => invoke('agent:tool', { sessionId, name, args }),
    mode: (sessionId, mode) => invoke('agent:mode', { sessionId, mode }),
    // How much runs without asking (agent/autonomy.js): main asks the person in its own window before loosening it.
    autonomy: (sessionId, level) => invoke('agent:autonomy', { sessionId, level }),
    files: (sessionId, query) => invoke('agent:files', { sessionId, query }),
    undo: (sessionId, count) => invoke('agent:undo', { sessionId, count }),
    browse: (sessionId, path) => invoke('agent:browse', { sessionId, path }),
    view: (sessionId, path) => invoke('agent:view', { sessionId, path }),
    exists: (sessionId, paths) => invoke('agent:exists', { sessionId, paths }),
    changes: sessionId => invoke('agent:changes', { sessionId }),
    open: (sessionId, target) => invoke('agent:open', { sessionId, target }),
    reveal: (sessionId, path) => invoke('agent:reveal', { sessionId, path }),
    abort: sessionId => invoke('agent:abort', { sessionId }),
    end: sessionId => invoke('agent:end', { sessionId }),
    clearRepos: () => invoke('agent:clear-repos'),
  },
  // Providers: the user's own API keys. A key can be saved or cleared from the page but never read back, and
  // requests to a provider go through the main process, which adds the key itself.
  providers: {
    list: () => invoke('providers:list'),
    setKey: (id, key) => invoke('providers:set-key', { id, key }),
    clearKey: id => invoke('providers:clear-key', { id }),
    saveCustom: entry => invoke('providers:save-custom', entry),
    removeCustom: id => invoke('providers:remove-custom', { id }),
    request: request => invoke('providers:request', request),
    abort: id => invoke('providers:abort', { id }),
    onEvent: callback => subscribe('providers:event', callback),
  },
  // Claude Agent: Claude through the person's own Claude Code login. The page sends a conversation and gets the reply;
  // it never sees the login and can't choose the program or its settings.
  ...(hasClaude && {
    claude: {
      status: options => invoke('claude:status', { check: options?.check === true }),
      models: () => invoke('claude:models'),
      request: request => invoke('claude:request', request),
      abort: id => invoke('claude:abort', { id }),
      onEvent: callback => subscribe('claude:event', callback),
    },
  }),
  // Web search and page reading. A search key can be saved or cleared but never read back.
  web: {
    state: () => invoke('web:state'),
    configure: patch => invoke('web:configure', patch),
    setKey: (backend, key) => invoke('web:set-key', { backend, key }),
    clearKey: backend => invoke('web:clear-key', { backend }),
    allow: (sessionId, urls) => invoke('web:allow', { sessionId, urls }),
    search: (sessionId, query, options) => invoke('web:search', { sessionId, query, count: options?.count, compact: options?.compact }),
    read: (sessionId, url, options) => invoke('web:read', { sessionId, url, compact: options?.compact }),
  },
  ...(hasEngine && {
    engine: {
      info: () => invoke('engine:info'),
      status: () => invoke('engine:status'),
      start: options => invoke('engine:start', options),
      // The faster build for the graphics card (accelerators.js): main decides what it is; the page can only ask.
      accelerator: {
        status: () => invoke('engine:accelerator:status'),
        install: () => invoke('engine:accelerator:install'),
        cancel: () => invoke('engine:accelerator:cancel'),
        use: on => invoke('engine:accelerator:use', { on: on === true }),
        remove: () => invoke('engine:accelerator:remove'),
        onEvent: callback => subscribe('engine:accelerator:event', callback),
      },
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
    // The local server for other apps (server/localApi.js): turning it on is asked about in a native dialog.
    localServer: {
      state: () => invoke('localapi:state'),
      set: on => invoke('localapi:set', { on: on === true }),
      renewKey: () => invoke('localapi:renew-key'),
      setPort: port => invoke('localapi:port', { port }),
    },
    // Images made on this computer (images/ipc.js): the page gives a downloaded model's id, a prompt and a shape.
    ...(hasImages && {
      images: {
        make: request => invoke('images:make', { modelId: request?.modelId, prompt: request?.prompt, aspect: request?.aspect, steps: request?.steps, cfg: request?.cfg, seed: request?.seed, size: request?.size, reference: request?.reference }),
        cancel: () => invoke('images:cancel'),
        // The person's own image models: chosen in a native dialog; the page gets an id, a name and a family, never a path.
        custom: {
          list: () => invoke('images:custom:list'),
          pick: () => invoke('images:custom:pick'),
          remove: id => invoke('images:custom:remove', { id }),
        },
        onEvent: callback => subscribe('images:event', callback),
      },
    }),
    // quo:// links from outside (links.js): the page is only told that one came, and takes the model main checked.
    links: {
      take: () => invoke('links:take'),
      onOpen: callback => subscribe('links:open', () => callback()),
    },
  }),
});
