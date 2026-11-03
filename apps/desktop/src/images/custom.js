'use strict';

// Image models the person already has: a file chosen in a native dialog (ipc.js), recognised by the tensors inside it
// (families.js), used in place and never copied. The list lives in main with each file's real path; the page sees an id,
// a name and the family, never the path.

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { readGgufTensors } = require('../engine/gguf');
const { hasModelHeader } = require('../engine/models');
const { ImageError, IMAGE_FILES } = require('./engine');
const { FAMILIES, UNSUPPORTED, familyOf } = require('./families');

const ID = /^imgc-[0-9a-f]{12}$/;
const MAX_HEADER = 100_000_000;

/** A safetensors file's tensors ([{ name, shape }]) from its JSON header, or null. */
async function readSafetensorsTensors(file) {
  let handle;
  try {
    handle = await fsp.open(file, 'r');
    const start = Buffer.alloc(8);
    await handle.read(start, 0, 8, 0);
    const length = Number(start.readBigUInt64LE(0));
    if (length < 2 || length > MAX_HEADER) return null;
    const header = Buffer.alloc(length);
    const { bytesRead } = await handle.read(header, 0, length, 8);
    if (bytesRead !== length) return null;
    const json = JSON.parse(header.toString('utf8'));
    return Object.entries(json).filter(([name]) => name !== '__metadata__').map(([name, info]) => ({ name, shape: Array.isArray(info?.shape) ? info.shape : [] }));
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}

const tensorsOf = file => (file.endsWith('.gguf') ? readGgufTensors(file) : readSafetensorsTensors(file));

class CustomImageModels {
  /** @param {{ listFile: string, store: import('../engine/models').ModelStore }} options */
  constructor({ listFile, store }) {
    this.listFile = listFile;
    this.store = store;
  }

  async read() {
    try {
      const list = JSON.parse(await fsp.readFile(this.listFile, 'utf8'));
      return Array.isArray(list) ? list.filter(entry => ID.test(entry?.id) && typeof entry.path === 'string' && Object.hasOwn(FAMILIES, entry.family)) : [];
    } catch {
      return [];
    }
  }

  async write(list) {
    await fsp.mkdir(path.dirname(this.listFile), { recursive: true });
    await fsp.writeFile(this.listFile, JSON.stringify(list, null, 2));
  }

  /** What the page may know about one: never the path. */
  static shown(entry) {
    const family = FAMILIES[entry.family];
    return { id: entry.id, name: entry.name, family: entry.family, label: family.label, steps: family.steps, cfg: family.cfg, edits: family.edits === true, ...(family.base ? { needs: family.baseName } : {}) };
  }

  async list() {
    return (await this.read()).filter(entry => fs.existsSync(entry.path)).map(CustomImageModels.shown);
  }

  /** Adds the file the person chose (a .gguf or .safetensors image model Quo can run), or says why it can't. */
  async add(file) {
    const real = await fsp.realpath(file).catch(() => null);
    if (!real || !/\.(gguf|safetensors)$/i.test(real) || !(await fsp.stat(real)).isFile()) throw new ImageError('unsupported', 'Choose a .gguf or .safetensors image model file.');
    if (!(await hasModelHeader(real, real.toLowerCase()))) throw new ImageError('unsupported', 'That file isn’t a whole GGUF or safetensors file.');
    const family = familyOf(await tensorsOf(real));
    if (!family) throw new ImageError('unsupported', UNSUPPORTED);
    const id = `imgc-${crypto.createHash('sha256').update(real).digest('hex').slice(0, 12)}`;
    const list = (await this.read()).filter(entry => entry.id !== id);
    const entry = { id, name: path.basename(real).replace(/\.(gguf|safetensors)$/i, '').slice(0, 80), family, path: real };
    await this.write([...list, entry]);
    return CustomImageModels.shown(entry);
  }

  async remove(id) {
    await this.write((await this.read()).filter(entry => entry.id !== id));
  }

  /**
   * The files sd-cli needs for a model the person added, checked again now (it may have moved or changed), and its
   * family. A diffusion-only file needs the Quo model it was made from, for that model's text model and decoder.
   */
  async resolve(id) {
    const entry = (await this.read()).find(one => one.id === id);
    if (!entry || !fs.existsSync(entry.path)) throw new ImageError('not_installed', 'That image model file isn’t there any more. Add it again in Models & storage.');
    if (familyOf(await tensorsOf(entry.path)) !== entry.family) throw new ImageError('not_installed', 'That image model file has changed. Add it again in Models & storage.');
    const family = FAMILIES[entry.family];
    if (family.kind === 'checkpoint') return { family: entry.family, files: { checkpoint: entry.path } };
    const base = name => this.store.filePath(family.base, name);
    for (const name of [IMAGE_FILES.text, IMAGE_FILES.vae]) {
      if (!(await hasModelHeader(base(name)))) throw new ImageError('needs_base', `Download ${family.baseName} first: this model uses its text model and decoder.`);
    }
    return { family: entry.family, files: { diffusion: entry.path, text: base(IMAGE_FILES.text), vae: base(IMAGE_FILES.vae) } };
  }
}

module.exports = { CustomImageModels, readSafetensorsTensors, ID };
