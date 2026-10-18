'use strict';

const fsp = require('node:fs/promises');
const { cleanBaseUrl } = require('../providers/registry');
const { WebError } = require('./errors');

/** Which search service to use, and a SearXNG address if one is set. Not secret (the keys are kept apart, in the key store). */

const BACKENDS = ['auto', 'brave', 'tavily', 'exa', 'searxng', 'duckduckgo'];

class WebConfig {
  constructor(file) {
    this.file = file;
  }

  async get() {
    try {
      const data = JSON.parse(await fsp.readFile(this.file, 'utf8'));
      return {
        backend: BACKENDS.includes(data.backend) ? data.backend : 'auto',
        searxngUrl: typeof data.searxngUrl === 'string' && cleanBaseUrl(data.searxngUrl) === data.searxngUrl ? data.searxngUrl : null,
      };
    } catch {
      return { backend: 'auto', searxngUrl: null };
    }
  }

  async set(patch) {
    const config = await this.get();
    if (patch.backend !== undefined) {
      if (!BACKENDS.includes(patch.backend)) throw new WebError('bad_args', 'That isn’t a search service Quo knows.');
      config.backend = patch.backend;
    }
    if (patch.searxngUrl !== undefined) {
      const clean = patch.searxngUrl === null || patch.searxngUrl === '' ? null : cleanBaseUrl(patch.searxngUrl);
      if (patch.searxngUrl && !clean) throw new WebError('bad_url', 'That address won’t work. Use https://…, or http:// for a server on this computer or your own network.');
      config.searxngUrl = clean;
    }
    await fsp.writeFile(this.file, JSON.stringify(config), { mode: 0o600 });
    return config;
  }
}

module.exports = { WebConfig, BACKENDS };
