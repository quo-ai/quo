'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, nativeTheme, session, shell, systemPreferences } = require('electron');
const { APP_HOST, APP_URL, API_ORIGIN, registerScheme, handleAppProtocol, setEngineTarget } = require('./protocol');
const { setupAgent } = require('./agent/ipc');
const { setupProviders } = require('./providers/ipc');
const { setupWeb } = require('./web/ipc');
const { engineAvailable, setupEngine } = require('./engine/ipc');
const { MIN_SIZE, loadWindowState, trackWindowState } = require('./windowState');
const { buildMenu } = require('./menu');
const { initAutoUpdates } = require('./updater');
const { runSmoke } = require('./smoke');
const { windowIcon } = require('./appIcon');
const { loadTheme, setupTheme, windowBackground } = require('./theme');

const isSmoke = process.argv.includes('--smoke') || process.env.QUO_SMOKE === '1';

// Bundled by electron-builder (extraResources) when packaged; ../web/dist in dev.
const webRoot = app.isPackaged
  ? path.join(process.resourcesPath, 'web')
  : path.resolve(process.env.QUO_WEB_DIR || path.join(__dirname, '../../web/dist'));

// App pages that only work on the hosted site. Paddle's checkout can't run in
// a cross-origin isolated page, so it opens in the browser.
const HOSTED_PAGES = ['/checkout.html'];
const EXTERNAL_PROTOCOLS = ['http:', 'https:', 'mailto:'];

// No Chromium switches needed: WebGPU (Metal / D3D12 / Vulkan) and JSPI are on
// by default in Electron 44. See README "WebGPU" before adding any.
registerScheme();
app.userAgentFallback = `${app.userAgentFallback} QuoDesktop/${app.getVersion()}`;
// Separate profiles, so dev builds and the smoke test run next to an installed
// Quo without sharing its data (or its single-instance lock).
if (process.env.QUO_PROFILE_DIR) {
  app.setPath('userData', path.resolve(process.env.QUO_PROFILE_DIR));
} else if (isSmoke) {
  const profile = path.join(os.tmpdir(), 'quo-smoke-profile');
  fs.rmSync(profile, { recursive: true, force: true });
  app.setPath('userData', profile);
} else if (!app.isPackaged) {
  app.setPath('userData', path.join(app.getPath('appData'), 'Quo Dev'));
}

let mainWindow = null;
// Whether this build includes the native llama.cpp engine (see engine.lock.json).
let hasEngine = false;

function createWindow({ hidden = false } = {}) {
  const state = loadWindowState();
  const icon = windowIcon({ packaged: app.isPackaged });
  const win = new BrowserWindow({
    ...state.bounds,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    title: 'Quo',
    ...(icon ? { icon } : {}),
    backgroundColor: windowBackground(),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      additionalArguments: [`--quo-version=${app.getVersion()}`, ...(hasEngine ? ['--quo-engine=1'] : [])],
    },
  });
  if (!hidden) {
    trackWindowState(win);
    win.once('ready-to-show', () => {
      if (state.maximized) win.maximize();
      win.show();
    });
  }
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  win.loadURL(APP_URL);
  mainWindow = win;
  return win;
}

/** Where a link should open outside the app, or null if it shouldn't. */
function externalUrl(href) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol === 'app:') {
    return url.host === APP_HOST && HOSTED_PAGES.includes(url.pathname) ? new URL(url.pathname + url.search, API_ORIGIN).href : null;
  }
  return EXTERNAL_PROTOCOLS.includes(url.protocol) ? url.href : null;
}

function isInAppUrl(href) {
  try {
    const url = new URL(href);
    return url.protocol === 'app:' && url.host === APP_HOST && !HOSTED_PAGES.includes(url.pathname);
  } catch {
    return false;
  }
}

function openExternal(href) {
  const url = externalUrl(href);
  if (url) shell.openExternal(url).catch(error => console.warn('[open]', error.message));
}

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', event => {
    if (isInAppUrl(event.url)) return;
    event.preventDefault();
    openExternal(event.url);
  });
  contents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
});

function focusMainWindow() {
  if (!mainWindow) return createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// Only what the app uses: the microphone (voice input, audio only), writing to
// the clipboard and fullscreen. Everything else is refused.
const PERMISSIONS = new Set(['media', 'clipboard-sanitized-write', 'fullscreen']);
const isAppOrigin = value => {
  try {
    const url = new URL(value);
    return url.protocol === 'app:' && url.host === APP_HOST;
  } catch {
    return false;
  }
};

function restrictPermissions(ses) {
  ses.setPermissionCheckHandler((_contents, permission, origin) => PERMISSIONS.has(permission) && isAppOrigin(origin));
  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    const allowed = PERMISSIONS.has(permission) && isAppOrigin(details.requestingUrl ?? contents.getURL());
    if (!allowed || permission !== 'media') return callback(allowed);
    if (details.mediaTypes?.some(type => type !== 'audio')) return callback(false);
    // macOS asks the user itself the first time; Windows and Linux just allow it.
    if (process.platform !== 'darwin') return callback(true);
    systemPreferences.askForMediaAccess('microphone').then(callback, () => callback(false));
  });
}

function start() {
  if (!fs.existsSync(path.join(webRoot, 'index.html'))) {
    console.error(`[quo] Web app not found at ${webRoot}. Run "npm run build:web" first.`);
  }
  handleAppProtocol(session.defaultSession, webRoot);
  restrictPermissions(session.defaultSession);
  loadTheme();
  setupTheme();
  nativeTheme.on('updated', () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setBackgroundColor(windowBackground()); });
  const { keys } = setupProviders();
  setupAgent({ web: setupWeb({ keys }) });
  hasEngine = engineAvailable();
  if (hasEngine) {
    const { engine } = setupEngine();
    setEngineTarget(() => engine.target(), { started: () => engine.requestStarted(), ended: () => engine.requestEnded() });
  } else {
    console.warn('[quo] The native engine is missing; using the in-browser engine. Run "npm run fetch:engine".');
  }
  if (isSmoke) return runSmoke(createWindow, webRoot);

  buildMenu();
  createWindow();
  initAutoUpdates();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

if (!isSmoke && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', focusMainWindow);
  app.on('window-all-closed', () => {
    // macOS apps stay running with no windows open.
    if (process.platform !== 'darwin') app.quit();
  });
  app.whenReady().then(start);
}
