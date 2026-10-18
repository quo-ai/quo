'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

/**
 * Models on disk, in <userData>/models/<model id>/<file>. Downloads are
 * resumable (HTTP Range into a .part file), retried while offline, and checked
 * for exact size and the GGUF header before they count as installed, the same
 * rules as the web app's downloader and the phone apps.
 *
 * Also keeps a list of models the user already has elsewhere (a file they
 * picked, or LM Studio / Ollama downloads), used in place without copying.
 */

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const FILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const isHuggingFace = url => url.protocol === 'https:' && url.hostname === 'huggingface.co';
const GGUF_MAGIC = Buffer.from('GGUF');
const PROGRESS_INTERVAL_MS = 250;
const MAX_BACKOFF_MS = 30_000;
const MIN_SCANNED_BYTES = 50 * 1024 * 1024;

class ModelError extends Error {
  constructor(code, message) {
    super(message ?? code);
    this.code = code;
  }
}

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new ModelError('cancelled'));
    }, { once: true });
  });

const sizeOf = file => fsp.stat(file).then(stat => (stat.isFile() ? stat.size : 0), () => 0);

async function hasGgufHeader(file) {
  let handle;
  try {
    handle = await fsp.open(file, 'r');
    const header = Buffer.alloc(4);
    const { bytesRead } = await handle.read(header, 0, 4, 0);
    return bytesRead === 4 && header.equals(GGUF_MAGIC);
  } catch {
    return false;
  } finally {
    await handle?.close();
  }
}

class ModelStore {
  /**
   * @param {{ directory: string, customFile: string, emit: (event: object) => void, isAllowedUrl?: (url: URL) => boolean }} options
   *   isAllowedUrl decides which download addresses are accepted (Hugging Face only, unless a test says otherwise).
   */
  constructor({ directory, customFile, emit, isAllowedUrl = isHuggingFace }) {
    this.directory = directory;
    this.customFile = customFile;
    this.emit = emit;
    this.isAllowedUrl = isAllowedUrl;
    this.active = new Map(); // modelId -> AbortController
  }

  dirFor(modelId) {
    if (!ID_PATTERN.test(modelId)) throw new ModelError('bad_model_id');
    return path.join(this.directory, modelId);
  }

  filePath(modelId, name) {
    if (!FILE_PATTERN.test(name)) throw new ModelError('bad_file_name');
    return path.join(this.dirFor(modelId), name);
  }

  /** What's on disk for a model made of `files` ([{ name, sizeBytes }]). */
  async state(modelId, files) {
    let downloaded = 0;
    let total = 0;
    let complete = true;
    for (const file of files) {
      const target = this.filePath(modelId, file.name);
      const done = await sizeOf(target);
      const part = done ? 0 : await sizeOf(`${target}.part`);
      total += file.sizeBytes;
      downloaded += Math.min(done || part, file.sizeBytes);
      if (done !== file.sizeBytes) complete = false;
    }
    if (complete && files.length) complete = await hasGgufHeader(this.filePath(modelId, files[0].name));
    return { installed: complete, downloadedBytes: complete ? total : downloaded, totalBytes: total };
  }

  isDownloading(modelId) {
    return this.active.has(modelId);
  }

  cancel(modelId) {
    this.active.get(modelId)?.abort();
  }

  async remove(modelId) {
    this.cancel(modelId);
    await fsp.rm(this.dirFor(modelId), { recursive: true, force: true });
  }

  /** Downloads every missing file of a model; progress arrives through `emit`. */
  async download(modelId, files) {
    if (this.active.has(modelId)) return;
    for (const file of files) {
      this.filePath(modelId, file.name);
      let url;
      try {
        url = new URL(file.url);
      } catch {
        throw new ModelError('bad_url');
      }
      if (!this.isAllowedUrl(url)) throw new ModelError('bad_url');
      if (!Number.isSafeInteger(file.sizeBytes) || file.sizeBytes <= 0) throw new ModelError('bad_size');
    }

    const controller = new AbortController();
    this.active.set(modelId, controller);
    const total = files.reduce((sum, file) => sum + file.sizeBytes, 0);
    const send = (type, extra = {}) => this.emit({ modelId, type, total, ...extra });
    try {
      await fsp.mkdir(this.dirFor(modelId), { recursive: true });
      await this.ensureSpace(modelId, files);
      let before = 0;
      for (const file of files) {
        const target = this.filePath(modelId, file.name);
        await this.downloadFile(file, target, controller.signal, {
          progress: loaded => send('progress', { loaded: before + loaded }),
          waiting: () => send('waiting'),
          verifying: () => send('verifying'),
        });
        before += file.sizeBytes;
      }
      send('done', { loaded: total });
    } catch (error) {
      const code = error instanceof ModelError ? error.code : 'download_failed';
      if (!(error instanceof ModelError)) console.warn('[models] download failed:', error?.message ?? error);
      send('error', { code, loaded: (await this.state(modelId, files)).downloadedBytes });
    } finally {
      this.active.delete(modelId);
    }
  }

  async ensureSpace(modelId, files) {
    let needed = 0;
    for (const file of files) {
      const target = this.filePath(modelId, file.name);
      if ((await sizeOf(target)) === file.sizeBytes) continue;
      needed += file.sizeBytes - (await sizeOf(`${target}.part`));
    }
    try {
      const stats = await fsp.statfs(this.directory);
      if (stats.bavail * stats.bsize < needed * 1.02 + 64 * 1024 * 1024) throw new ModelError('no_space');
    } catch (error) {
      if (error instanceof ModelError) throw error;
      // Free space couldn't be read; the download will report any real failure.
    }
  }

  async downloadFile(file, target, signal, hooks) {
    if ((await sizeOf(target)) === file.sizeBytes && (await hasGgufHeader(target))) return;
    const part = `${target}.part`;
    let attempt = 0;
    let lastEmit = 0;

    while ((await sizeOf(part)) !== file.sizeBytes) {
      if (signal.aborted) throw new ModelError('cancelled');
      let have = await sizeOf(part);
      if (have > file.sizeBytes) {
        await fsp.rm(part, { force: true });
        have = 0;
      }
      let out;
      try {
        const response = await fetch(file.url, {
          headers: have ? { Range: `bytes=${have}-` } : {},
          redirect: 'follow',
          signal,
        });
        if (response.status === 416) {
          await fsp.rm(part, { force: true }); // our partial file doesn't match the server's
          continue;
        }
        if (!response.ok || !response.body) {
          const retryable = response.status >= 500 || response.status === 408 || response.status === 429;
          if (!retryable) throw new ModelError(`http_${response.status}`);
          throw new Error(`HTTP ${response.status}`);
        }
        const restart = have > 0 && response.status === 200; // the server ignored Range
        let offset = restart ? 0 : have;
        out = fs.createWriteStream(part, { flags: offset ? 'a' : 'w' });
        const failed = new Promise((_, reject) => out.once('error', reject));
        failed.catch(() => {});
        const reader = response.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!out.write(value)) await Promise.race([new Promise(resolve => out.once('drain', resolve)), failed]);
          offset += value.length;
          const now = Date.now();
          if (now - lastEmit >= PROGRESS_INTERVAL_MS) {
            lastEmit = now;
            hooks.progress(Math.min(offset, file.sizeBytes));
          }
        }
        attempt = 0;
      } catch (error) {
        if (signal.aborted) throw new ModelError('cancelled');
        if (error instanceof ModelError) throw error;
        hooks.waiting(); // offline or a flaky connection: keep trying
        await sleep(Math.min(1000 * 2 ** attempt++, MAX_BACKOFF_MS), signal);
      } finally {
        if (out) await new Promise(resolve => out.end(resolve));
      }
    }

    hooks.progress(file.sizeBytes);
    hooks.verifying();
    if (!(await hasGgufHeader(part))) {
      await fsp.rm(part, { force: true });
      throw new ModelError('not_gguf');
    }
    await fsp.rename(part, target);
  }

  // ----- Models the user already has -----

  async customModels() {
    try {
      const list = JSON.parse(await fsp.readFile(this.customFile, 'utf8'));
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  async saveCustom(list) {
    await fsp.mkdir(path.dirname(this.customFile), { recursive: true });
    await fsp.writeFile(this.customFile, JSON.stringify(list, null, 2));
  }

  /** Registers a GGUF file (and its vision projector, if one sits beside it), used in place. */
  async addCustom(file, { name, mmprojPath } = {}) {
    const resolved = await fsp.realpath(file).catch(() => null);
    if (!resolved || !(await hasGgufHeader(resolved))) throw new ModelError('not_gguf', 'That isn’t a GGUF model file.');
    const sizeBytes = await sizeOf(resolved);
    const id = `custom-${crypto.createHash('sha1').update(resolved).digest('hex').slice(0, 10)}`;
    const mmproj = mmprojPath ?? (await findProjector(resolved));
    const entry = {
      id,
      name: name ?? path.basename(resolved).replace(/\.gguf$/i, ''),
      path: resolved,
      sizeBytes,
      ...(mmproj ? { mmprojPath: mmproj } : {}),
    };
    const list = (await this.customModels()).filter(item => item.id !== id);
    list.push(entry);
    await this.saveCustom(list);
    return entry;
  }

  async removeCustom(id) {
    await this.saveCustom((await this.customModels()).filter(item => item.id !== id));
  }

  /** The registered custom model with this id, if its file still exists. */
  async resolveCustom(id) {
    const entry = (await this.customModels()).find(item => item.id === id);
    if (!entry || !(await sizeOf(entry.path))) return null;
    if (entry.mmprojPath && !(await sizeOf(entry.mmprojPath))) delete entry.mmprojPath;
    return entry;
  }

  /** GGUF models found in LM Studio's and Ollama's folders, not yet added. */
  async scanExternal() {
    const home = os.homedir();
    const known = new Set((await this.customModels()).map(item => item.path));
    const found = [];
    // The list of added models stores real paths, so compare real paths: the folder may be reached through a symlink.
    const add = async entry => {
      const real = await fsp.realpath(entry.path).catch(() => entry.path);
      if (!known.has(real) && found.length < 300) found.push(entry);
    };

    for (const root of [path.join(home, '.lmstudio', 'models'), path.join(home, '.cache', 'lm-studio', 'models')]) {
      for (const file of await walk(root, 5)) {
        if (!/\.gguf$/i.test(file) || /^mmproj/i.test(path.basename(file))) continue;
        const sizeBytes = await sizeOf(file);
        if (sizeBytes < MIN_SCANNED_BYTES) continue;
        const projector = await findProjector(file);
        await add({ name: path.basename(file).replace(/\.gguf$/i, ''), path: file, sizeBytes, source: 'lmstudio', ...(projector ? { mmprojPath: projector } : {}) });
      }
    }

    const ollamaRoots = [process.env.OLLAMA_MODELS, path.join(home, '.ollama', 'models'), '/usr/share/ollama/.ollama/models'].filter(Boolean);
    for (const root of ollamaRoots) {
      const manifests = path.join(root, 'manifests');
      for (const file of await walk(manifests, 6)) {
        let manifest;
        try {
          manifest = JSON.parse(await fsp.readFile(file, 'utf8'));
        } catch {
          continue;
        }
        const blob = type => {
          const digest = manifest.layers?.find(layer => layer.mediaType === `application/vnd.ollama.image.${type}`)?.digest;
          return typeof digest === 'string' && /^sha256:[0-9a-f]{64}$/.test(digest) ? path.join(root, 'blobs', digest.replace(':', '-')) : null;
        };
        const modelBlob = blob('model');
        if (!modelBlob || !(await hasGgufHeader(modelBlob))) continue;
        const parts = path.relative(manifests, file).split(path.sep);
        const tag = parts.pop();
        const model = parts.pop();
        const namespace = parts.pop();
        const label = `${namespace && namespace !== 'library' ? `${namespace}/` : ''}${model}:${tag}`;
        const projector = blob('projector');
        await add({ name: label, path: modelBlob, sizeBytes: await sizeOf(modelBlob), source: 'ollama', ...(projector && (await sizeOf(projector)) ? { mmprojPath: projector } : {}) });
      }
    }
    return found;
  }
}

/**
 * The vision projector that belongs to a model: only when its folder holds
 * exactly one model and one projector (how LM Studio and the downloads from
 * Hugging Face are laid out). In a folder of unrelated models a projector
 * could belong to any of them, so none is guessed.
 */
async function findProjector(modelFile) {
  const directory = path.dirname(modelFile);
  try {
    const files = (await fsp.readdir(directory)).filter(name => /\.gguf$/i.test(name));
    const projectors = files.filter(name => /^mmproj/i.test(name));
    const models = files.filter(name => !/^mmproj/i.test(name));
    return projectors.length === 1 && models.length === 1 ? path.join(directory, projectors[0]) : null;
  } catch {
    return null;
  }
}

/** Files under `root` (depth-limited, never follows links), or [] if it doesn't exist. */
async function walk(root, depth) {
  const out = [];
  async function visit(directory, level) {
    let entries;
    try {
      entries = await fsp.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory() && level < depth) await visit(full, level + 1);
      else if (entry.isFile()) out.push(full);
    }
  }
  await visit(root, 0);
  return out;
}

module.exports = { ModelStore, ModelError, hasGgufHeader, findProjector };
