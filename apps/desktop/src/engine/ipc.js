'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { trusted } = require('../trust');
const lock = require('../../engine.lock.json');
const { startWithCache, startWithFallback } = require('./fallback');
const { Accelerators, AcceleratorError } = require('./accelerators');
const { LlamaEngine, EngineError, binaryIn, engineTarget, listDevicesIn } = require('./llama');
const { ModelStore, ModelError } = require('./models');

/**
 * Connects the web app to the native engine. Everything here is reachable only
 * from the app's own pages (app://quo): model downloads, loading a model into
 * llama-server, and importing models the user already has. Chat itself goes
 * through the protocol handler (protocol.js), not IPC.
 */

function engineDirectory() {
  if (process.env.QUO_ENGINE_DIR) return path.resolve(process.env.QUO_ENGINE_DIR);
  const target = engineTarget();
  if (!target) return null;
  return app.isPackaged ? path.join(process.resourcesPath, 'engine', target) : path.join(__dirname, '../../engine', target);
}

/** True when the bundled llama-server exists for this platform. */
function engineAvailable() {
  const directory = engineDirectory();
  return Boolean(directory) && new LlamaEngine({ directory }).available;
}

const broadcast = (channel, payload) => BrowserWindow.getAllWindows().forEach(window => window.webContents.send(channel, payload));
const exists = file => fsp.access(file).then(() => true, () => false);
const clamp = (value, min, max, fallback) => (Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback);

function setupEngine() {
  const userData = app.getPath('userData');
  const directory = engineDirectory() ?? path.join(userData, 'no-engine');
  const engine = new LlamaEngine({ directory, pidFile: path.join(userData, 'engine.pid') });
  // A faster build for the graphics card, if the person downloaded one (accelerators.js). Not with a test engine.
  const accelerators = new Accelerators({
    root: path.join(userData, 'engines'),
    choiceFile: path.join(userData, 'engine-choice.json'),
    lock,
    target: process.env.QUO_ENGINE_DIR ? null : engineTarget(),
    binaryName: path.basename(binaryIn(directory)),
    listDevices: listDevicesIn,
  });
  /** Moves the engine to the faster build or back to the bundled one, as the choice and what is installed say. */
  let ready = Promise.resolve();
  const settle = () => (ready = (async () => engine.useDirectory((await accelerators.engineDir()) ?? directory))().catch(() => {}));
  settle();
  const store = new ModelStore({
    directory: path.join(userData, 'models'),
    customFile: path.join(userData, 'custom-models.json'),
    emit: event => broadcast('models:event', event),
  });

  void engine.reapStale();
  engine.on('exit', ({ code, signal, expected }) => {
    if (!expected) broadcast('engine:event', { type: 'exit', code, signal });
  });
  // Never leave a model loaded in an engine nobody is using. A normal quit, the
  // process ending and the usual termination signals all stop it; if the app is
  // killed outright (SIGKILL, a crash), the next launch ends the orphan (reapStale).
  app.on('will-quit', () => engine.killNow());
  process.on('exit', () => engine.killNow());
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {
      engine.killNow();
      app.quit();
    });
  }

  // Errors travel as data: Electron drops custom properties of thrown errors.
  const handle = (channel, task) =>
    ipcMain.handle(channel, async (event, payload) => {
      if (!trusted(event)) return { error: { code: 'untrusted', message: 'Not allowed.' } };
      try {
        return { ok: await task(payload ?? {}) };
      } catch (error) {
        if (error instanceof EngineError || error instanceof ModelError) {
          return { error: { code: error.code, message: error.message } };
        }
        console.warn(`[${channel}]`, error);
        return { error: { code: 'failed', message: 'Something went wrong.' } };
      }
    });

  handle('engine:info', async () => (await ready, {
    available: engine.available,
    accelerated: engine.directory !== directory,
    release: lock.release,
    platform: process.platform,
    arch: process.arch,
    ramBytes: os.totalmem(),
    freeRamBytes: os.freemem(),
    cpus: os.cpus().length,
    devices: await engine.devices(),
    modelsDir: store.directory,
  }));

  handle('engine:accelerator:status', async () => ({ ...(await accelerators.status()), active: engine.directory !== directory }));
  handle('engine:accelerator:install', () => {
    // Progress and the result arrive as engine:accelerator:event messages. Nothing from the page decides what is fetched.
    accelerators.install({ onProgress: (loaded, total) => broadcast('engine:accelerator:event', { type: 'progress', loaded, total }) })
      .then(async () => {
        await settle();
        broadcast('engine:accelerator:event', { type: 'done', status: { ...(await accelerators.status()), active: engine.directory !== directory } });
      })
      .catch(error => broadcast('engine:accelerator:event', { type: 'error', code: error instanceof AcceleratorError ? error.code : 'failed', message: error instanceof AcceleratorError ? error.message : 'Something went wrong.' }));
    return true;
  });
  handle('engine:accelerator:cancel', () => accelerators.cancel());
  handle('engine:accelerator:use', async ({ on }) => {
    await accelerators.use(on === true);
    await settle();
    return { ...(await accelerators.status()), active: engine.directory !== directory };
  });
  handle('engine:accelerator:remove', async () => {
    await engine.useDirectory(directory);
    await accelerators.remove();
    return { ...(await accelerators.status()), active: false };
  });

  handle('engine:status', () => engine.status());
  handle('engine:stop', () => engine.stop());

  handle('engine:start', async ({ modelId, contextSize, kvType }) => {
    let modelPath;
    let mmprojPath;
    let draftPath = null;
    if (String(modelId).startsWith('custom-')) {
      const entry = await store.resolveCustom(modelId);
      if (!entry) throw new ModelError('model_missing', 'That model file can’t be found any more.');
      modelPath = entry.path;
      mmprojPath = entry.mmprojPath;
    } else {
      modelPath = store.filePath(modelId, 'model.gguf');
      if (!(await exists(modelPath))) throw new ModelError('model_missing', 'That model isn’t downloaded yet.');
      const projector = store.filePath(modelId, 'mmproj.gguf');
      if (await exists(projector)) mmprojPath = projector;
      // A drafter beside the model (Gemma 4's multi-token-prediction file) makes it write faster; without one it still runs.
      const draft = store.filePath(modelId, 'draft.gguf');
      if (await exists(draft)) draftPath = draft;
    }
    // Too big for this computer's memory with that window: try a smaller one (a model that fits is better than an error).
    const asked = clamp(contextSize, 2048, 131072, 8192);
    const run = cache => startWithFallback((size, options) => engine.start({ modelId, modelPath, mmprojPath, draftPath, contextSize: size, cpuProjector: options.cpuProjector, kvType: cache }), asked, { hasProjector: Boolean(mmprojPath) });
    await ready;
    let status;
    try {
      status = await startWithCache(run, kvType);
    } catch (error) {
      // The faster build failed where the bundled one may not: note it, go back, and try once more.
      if (engine.directory === directory || error?.code === 'model_missing' || error?.code === 'out_of_memory') throw error;
      await accelerators.markFailed(error?.code);
      await engine.useDirectory(directory);
      status = await startWithCache(run, kvType);
    }
    return { ...status, requestedContextSize: asked };
  });

  handle('models:state', ({ modelId, files }) => store.state(modelId, files));

  handle('models:download', ({ modelId, files }) => {
    // Progress and the result arrive as models:event messages.
    store.download(modelId, files).catch(error => {
      broadcast('models:event', { modelId, type: 'error', code: error instanceof ModelError ? error.code : 'download_failed', loaded: 0, total: 0 });
    });
    return true;
  });
  handle('models:cancel', ({ modelId }) => store.cancel(modelId));

  handle('models:remove', async ({ modelId }) => {
    if (engine.status().modelId === modelId) await engine.stop();
    await store.remove(modelId);
  });

  handle('models:reveal', async () => {
    await fsp.mkdir(store.directory, { recursive: true });
    await shell.openPath(store.directory);
  });

  handle('models:custom:list', async () => {
    const list = await store.customModels();
    const present = [];
    for (const entry of list) if (await exists(entry.path)) present.push(entry);
    return present;
  });
  handle('models:custom:scan', () => store.scanExternal());
  handle('models:custom:add', ({ path: file, name, mmprojPath }) => store.addCustom(String(file), { name, mmprojPath }));
  handle('models:custom:pick', async (_payload) => {
    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const result = await dialog.showOpenDialog(window, {
      title: 'Choose a model file',
      properties: ['openFile'],
      filters: [{ name: 'GGUF models', extensions: ['gguf'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return store.addCustom(result.filePaths[0]);
  });
  handle('models:custom:remove', async ({ id }) => {
    if (engine.status().modelId === id) await engine.stop();
    await store.removeCustom(id);
  });

  return { engine, store };
}

module.exports = { setupEngine, engineAvailable, engineDirectory };
