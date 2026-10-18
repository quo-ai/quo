'use strict';

const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const { CUSTOM_ID, PROTOCOLS, cleanBaseUrl } = require('./registry');
const { ProviderError } = require('./errors');

/**
 * Servers the user adds themselves (Ollama or LM Studio on this computer, a company gateway, any OpenAI-style
 * address). The address is kept here, in the main process, so the page can't send a key somewhere else:
 * changing a server's address takes its key away (see ipc.js).
 */

const MAX_ENDPOINTS = 10;

class Endpoints {
  constructor(file) {
    this.file = file;
  }

  async list() {
    try {
      const data = JSON.parse(await fsp.readFile(this.file, 'utf8'));
      return (Array.isArray(data.endpoints) ? data.endpoints : []).filter(e => e && CUSTOM_ID.test(e.id) && PROTOCOLS.has(e.protocol) && cleanBaseUrl(e.baseUrl) === e.baseUrl && typeof e.name === 'string');
    } catch {
      return [];
    }
  }

  async write(endpoints) {
    await fsp.writeFile(this.file, JSON.stringify({ endpoints }), { mode: 0o600 });
  }

  async get(id) {
    return (await this.list()).find(e => e.id === id) ?? null;
  }

  /** Adds a server or updates one. Returns it, and whether its address or format changed. */
  async save({ id, name, baseUrl, protocol }) {
    const list = await this.list();
    const clean = cleanBaseUrl(baseUrl);
    if (!clean) throw new ProviderError('bad_url', 'That address won’t work. Use https://…, or http:// for a server on this computer or your own network.');
    if (!PROTOCOLS.has(protocol)) throw new ProviderError('bad_protocol', 'Choose how the server talks: OpenAI-style or Anthropic-style.');
    const label = String(name ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40);
    if (!label) throw new ProviderError('bad_name', 'Give the server a name.');
    const existing = id ? list.find(e => e.id === id) : null;
    if (id && !existing) throw new ProviderError('unknown_provider', 'That server isn’t in the list any more.');
    if (!existing && list.length >= MAX_ENDPOINTS) throw new ProviderError('too_many', `You can add up to ${MAX_ENDPOINTS} servers.`);
    const entry = { id: existing?.id ?? `custom-${crypto.randomBytes(4).toString('hex')}`, name: label, baseUrl: clean, protocol };
    await this.write([...list.filter(e => e.id !== entry.id), entry]);
    return { entry, changed: Boolean(existing) && (existing.baseUrl !== clean || existing.protocol !== protocol) };
  }

  async remove(id) {
    await this.write((await this.list()).filter(e => e.id !== id));
  }
}

module.exports = { Endpoints };
