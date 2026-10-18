'use strict';

const path = require('node:path');
const { app, ipcMain } = require('electron');
const { AgentError } = require('../agent/safety');
const { trusted } = require('../trust');
const { WebConfig } = require('./config');
const { WebError } = require('./errors');
const { renderPage } = require('./render');
const { BACKENDS } = require('./search');
const { WebService } = require('./service');

/**
 * Connects the web app to web search and page reading, from the app's own pages only. A search key can be saved or
 * cleared but never read back (it lives in the same encrypted store as the provider keys). The service decides which
 * addresses may be opened (sessions.js); this only passes requests in and answers out.
 */

const COMPACT_CHARS = 5000;
const FULL_CHARS = 14_000;

function setupWeb({ keys }) {
  const config = new WebConfig(path.join(app.getPath('userData'), 'web-search.json'));
  const service = new WebService({ keys, config, render: renderPage });

  const handle = (channel, task) =>
    ipcMain.handle(channel, async (event, payload) => {
      if (!trusted(event)) return { error: { code: 'untrusted', message: 'Not allowed.' } };
      try {
        return { ok: await task(payload ?? {}) };
      } catch (error) {
        if (error instanceof AgentError) return { error: { code: error.code, message: error.message } };
        console.warn(`[${channel}]`, error?.message);
        return { error: { code: 'failed', message: 'Something went wrong.' } };
      }
    });

  const keyed = backend => {
    if (!BACKENDS[backend]?.needsKey) throw new WebError('bad_args', 'That search service doesn’t use a key.');
    return `web:${backend}`;
  };

  handle('web:state', () => service.state());
  handle('web:configure', async patch => {
    await config.set({ backend: patch.backend, searxngUrl: patch.searxngUrl });
    return service.state();
  });
  handle('web:set-key', async ({ backend, key }) => {
    await keys.set(keyed(backend), key);
    return service.state();
  });
  handle('web:clear-key', async ({ backend }) => {
    await keys.clear(keyed(backend));
    return service.state();
  });
  // Addresses the user wrote in a message: the model may open those, as written.
  handle('web:allow', ({ sessionId, urls }) => {
    service.sessions.allow(sessionId, (Array.isArray(urls) ? urls : []).slice(0, 20).filter(url => typeof url === 'string' && /^https?:\/\//i.test(url) && url.length < 2000));
  });
  handle('web:search', ({ sessionId, query, count, compact }) => service.search(sessionId, query, { count, maxChars: compact ? COMPACT_CHARS : FULL_CHARS }));
  handle('web:read', ({ sessionId, url, compact }) => service.read(sessionId, url, { maxChars: compact ? COMPACT_CHARS : FULL_CHARS }));
  return service;
}

module.exports = { setupWeb };
