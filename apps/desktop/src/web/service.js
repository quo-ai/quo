'use strict';

const { redactSecrets } = require('../agent/safety');
const { WebError } = require('./errors');
const { extractReadable, needsRendering } = require('./extract');
const { normalizeUrl } = require('./guard');
const { fetchPage } = require('./page');
const { AUTO_ORDER, BACKENDS, search } = require('./search');
const { WebSessions } = require('./sessions');

/**
 * What the model can do on the web: search, and read a page. Search results, the user's own addresses and links on
 * pages already read are the only addresses it may open (sessions.js). It never gets cookies, logins or the user's
 * files, and what it reads is data for the model, not instructions.
 */

const keyId = backend => `web:${backend}`;
const MAX_CHARS = 14_000;

class WebService {
  constructor({ keys, config, sessions = new WebSessions(), fetchFn = globalThis.fetch, fetchPageFn = fetchPage, render = null, allowPrivate = false }) {
    this.allowPrivate = allowPrivate; // tests only: pages on this computer
    this.keys = keys;
    this.config = config;
    this.sessions = sessions;
    this.fetch = fetchFn;
    this.fetchPage = fetchPageFn;
    this.render = render;
  }

  /** What the settings screen shows: the choice, the address, and which services have a key. */
  async state() {
    const config = await this.config.get();
    const keyed = Object.entries(BACKENDS).filter(([, meta]) => meta.needsKey).map(([id]) => id);
    const states = await this.keys.states(keyed.map(keyId));
    return {
      ...config,
      secure: this.keys.secure,
      backends: Object.entries(BACKENDS).map(([id, meta]) => {
        const saved = states.find(state => state.id === keyId(id));
        return { id, name: meta.name, needsKey: Boolean(meta.needsKey), needsUrl: Boolean(meta.needsUrl), keyUrl: meta.keyUrl ?? null, configured: saved ? saved.configured : id === 'searxng' ? Boolean(config.searxngUrl) : true, last4: saved?.last4 ?? null };
      }),
    };
  }

  /** The services to try for a search, in order. */
  async #order(config) {
    const order = config.backend === 'auto' ? AUTO_ORDER : [config.backend];
    const usable = [];
    for (const id of order) {
      const meta = BACKENDS[id];
      const key = meta.needsKey ? await this.keys.get(keyId(id)) : null;
      if (meta.needsKey && !key) {
        if (config.backend !== 'auto') throw new WebError('no_key', `No key is saved for ${meta.name}. Add one in Models & storage → Web.`);
        continue;
      }
      if (meta.needsUrl && !config.searxngUrl) {
        if (config.backend !== 'auto') throw new WebError('no_url', 'No SearXNG address is set. Add one in Models & storage → Web.');
        continue;
      }
      usable.push({ id, key, url: config.searxngUrl });
    }
    return usable;
  }

  async search(sessionId, rawQuery, { count = 6, maxChars = MAX_CHARS } = {}) {
    const query = redactSecrets(String(rawQuery ?? '')).replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!query) throw new WebError('bad_args', 'web_search needs a query.');
    const limit = Math.min(10, Math.max(1, Math.trunc(Number(count)) || 6));
    let failure = null;
    for (const backend of await this.#order(await this.config.get())) {
      try {
        const results = await search(backend.id, { query, count: limit, key: backend.key, url: backend.url, fetchFn: this.fetch });
        this.sessions.allow(sessionId, results.map(result => result.url));
        const name = BACKENDS[backend.id].name;
        const list = results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}${r.snippet ? `\n   ${r.snippet}` : ''}`).join('\n');
        const text = results.length
          ? `Web search for “${query}” (${name}):\n\n${list}\n\nOpen a page with fetch_url, using one of these exact addresses. Cite what you use as links.`
          : `Web search for “${query}” (${name}) found nothing. Try different words.`;
        return { text: redactSecrets(text).slice(0, maxChars), display: { kind: 'web_search', query, backend: name, results: results.map(({ title, url }) => ({ title, url })) } };
      } catch (error) {
        failure = error;
      }
    }
    throw failure ?? new WebError('no_backend', 'No search service is set up. Add one in Models & storage → Web.');
  }

  async read(sessionId, rawUrl, { maxChars = MAX_CHARS } = {}) {
    const url = String(rawUrl ?? '').trim();
    if (!url) throw new WebError('bad_args', 'fetch_url needs a url.');
    if (!this.sessions.allows(sessionId, url)) {
      throw new WebError('not_allowed', `Quo only opens addresses that came from a web search, from the user’s message, or from a page it has already read, exactly as written. ${normalizeUrl(url).slice(0, 200)} isn’t one of them: search for it instead.`);
    }
    const page = await this.fetchPage(url, this.allowPrivate ? { allowPrivate: true } : {});
    let title = '';
    let body = page.text;
    let links = [];
    if (/html|xml/i.test(page.contentType) || /^\s*<(!doctype|html)/i.test(body)) {
      let extracted = extractReadable(body, page.url);
      if (needsRendering(body, extracted.text) && this.render) {
        try {
          const rendered = await this.render(page.url);
          const again = extractReadable(rendered.html, rendered.url);
          if (again.text.length > extracted.text.length) extracted = again;
        } catch {
          // Keep what the plain fetch gave.
        }
      }
      ({ title, text: body, links } = extracted);
    }
    this.sessions.allow(sessionId, links.map(link => link.url));
    const clipped = body.length > maxChars;
    const list = links.length ? `\n\nLinks on this page (open one with fetch_url):\n${links.slice(0, 15).map((link, i) => `[${i + 1}] ${link.text} — ${link.url}`).join('\n')}` : '';
    const text = `Page: ${title || page.url}\nAddress: ${page.url}\n\n${redactSecrets(body.slice(0, maxChars))}${clipped || page.truncated ? '\n… [the rest of the page is left out]' : ''}${list}`;
    return { text, display: { kind: 'fetch', url: page.url, title: title || page.url, chars: Math.min(body.length, maxChars) } };
  }
}

module.exports = { WebService };
