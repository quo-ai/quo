'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const { ProviderError } = require('./errors');

/**
 * The user's API keys. On disk they are encrypted with the operating system's secure storage (Keychain on
 * macOS, DPAPI on Windows, the desktop's secret service on Linux), so another program or another user can't
 * read them from the file. Where the system has no such storage (some Linux setups), keys are kept in memory
 * until Quo quits, and the app says so, rather than writing them out in the clear.
 *
 * Nothing here ever leaves the main process: the page can store a key, clear one and see the last four
 * characters, and requests carry the key without the page seeing it.
 */

const KEY_SHAPE = /^[\x21-\x7e]{8,500}$/;

class KeyStore {
  constructor({ file, safeStorage }) {
    this.file = file;
    this.safe = safeStorage;
    this.memory = new Map();
    this.saved = null;
  }

  /** Whether keys are kept encrypted on disk. */
  get secure() {
    try {
      if (!this.safe?.isEncryptionAvailable()) return false;
      const backend = this.safe.getSelectedStorageBackend?.();
      return backend !== 'basic_text' && backend !== 'unknown';
    } catch {
      return false;
    }
  }

  async load() {
    if (this.saved) return this.saved;
    try {
      const data = JSON.parse(await fsp.readFile(this.file, 'utf8'));
      this.saved = data && typeof data.keys === 'object' && data.keys ? { ...data.keys } : {};
    } catch {
      this.saved = {};
    }
    return this.saved;
  }

  async persist() {
    const temporary = `${this.file}.${process.pid}.tmp`;
    await fsp.mkdir(path.dirname(this.file), { recursive: true });
    await fsp.writeFile(temporary, JSON.stringify({ keys: this.saved }), { mode: 0o600 });
    await fsp.rename(temporary, this.file);
  }

  async get(id) {
    if (this.memory.has(id)) return this.memory.get(id);
    const encrypted = (await this.load())[id];
    if (!encrypted || !this.secure) return null;
    try {
      return this.safe.decryptString(Buffer.from(encrypted, 'base64'));
    } catch {
      return null; // saved under another account or machine: treat as not saved
    }
  }

  async set(id, key) {
    const clean = String(key ?? '').trim();
    if (!KEY_SHAPE.test(clean)) throw new ProviderError('bad_key', 'That doesn’t look like an API key. A key has no spaces or line breaks.');
    if (this.secure) {
      const saved = await this.load();
      saved[id] = this.safe.encryptString(clean).toString('base64');
      this.memory.delete(id);
      await this.persist();
    } else this.memory.set(id, clean);
  }

  async clear(id) {
    this.memory.delete(id);
    const saved = await this.load();
    if (id in saved) {
      delete saved[id];
      await this.persist();
    }
  }

  /** Which of `ids` have a key, and its last four characters. */
  async states(ids) {
    const states = [];
    for (const id of ids) {
      const key = await this.get(id);
      states.push({ id, configured: key !== null, last4: key ? key.slice(-4) : null });
    }
    return states;
  }
}

module.exports = { KeyStore };
