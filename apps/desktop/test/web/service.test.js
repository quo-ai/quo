'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { describe, it } = require('node:test');
const { KeyStore } = require('../../src/providers/keystore');
const { AgentSession, PLAN_TOOLS, TOOL_NAMES } = require('../../src/agent/session');
const { WebConfig } = require('../../src/web/config');
const { WebService } = require('../../src/web/service');
const { fakeSafeStorage, temp } = require('../providers/helpers');

const rejects = (promise, code) => assert.rejects(promise, error => error.code === code, `expected ${code}`);

async function site(routes) {
  const server = http.createServer((q, r) => { const page = routes[q.url] ?? '<p>missing</p>'; r.writeHead(200, { 'content-type': 'text/html' }); r.end(page); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => { server.closeAllConnections?.(); server.close(); } };
}

function service({ render, fetchFn } = {}) {
  const dir = temp();
  const keys = new KeyStore({ file: path.join(dir, 'keys.json'), safeStorage: fakeSafeStorage() });
  return new WebService({ keys, config: new WebConfig(path.join(dir, 'web.json')), render, allowPrivate: true, fetchFn: fetchFn ?? (async () => new Response('<html></html>')) });
}
const article = body => `<html><head><title>Doc</title></head><body><article><h1>Doc</h1><p>${'Words about things. '.repeat(40)}${body}</p></article></body></html>`;

describe('opening pages', () => {
  it('opens only what the conversation was given, as written', async () => {
    const s = await site({ '/a': article('<a href="/b">next page</a>'), '/b': article('second'), '/c': article('secret') });
    try {
      const web = service();
      await assert.rejects(web.read('chat1', `${s.url}/a`), error => error.code === 'not_allowed' && /exactly as written/.test(error.message));
      web.sessions.allow('chat1', [`${s.url}/a`]);
      const first = await web.read('chat1', `${s.url}/a`);
      assert.match(first.text, /^Page: Doc\nAddress: /);
      assert.match(first.text, /Words about things/);
      assert.equal(first.display.kind, 'fetch');
      // A link on a page it has read can be opened; an address with something added, or never seen, cannot.
      assert.match((await web.read('chat1', `${s.url}/b`)).text, /second/);
      await rejects(web.read('chat1', `${s.url}/b?leak=the+conversation`), 'not_allowed');
      await rejects(web.read('chat1', `${s.url}/c`), 'not_allowed');
      await rejects(web.read('chat2', `${s.url}/a`), 'not_allowed');
    } finally { s.close(); }
  });

  it('opens an address a search returned', async () => {
    const s = await site({ '/found': article('result') });
    try {
      const web = service({ fetchFn: async () => new Response(JSON.stringify({ web: { results: [{ title: 'Found', url: `${s.url}/found`, description: 'd' }] } })) });
      await web.keys.set('web:brave', `${'brave'}-${'test'}-${'abcdefghijkl1234'}`);
      await rejects(web.read('chat-c', `${s.url}/found`), 'not_allowed');
      assert.match((await web.search('chat-c', 'x')).text, /\/found/);
      assert.match((await web.read('chat-c', `${s.url}/found`)).text, /result/);
    } finally { s.close(); }
  });

  it('turns plain text and JSON into text, cuts a long page, and reads nothing it shouldn’t', async () => {
    const s = await site({ '/long': article('x'.repeat(30_000)) });
    try {
      const web = service();
      web.sessions.allow('chat-c', [`${s.url}/long`, 'http://169.254.169.254/latest/meta-data/', 'file:///etc/passwd']);
      const long = await web.read('chat-c', `${s.url}/long`, { maxChars: 3000 });
      assert.ok(long.text.length < 3500);
      assert.match(long.text, /the rest of the page is left out/);
    } finally { s.close(); }
    const strict = new WebService({ keys: service().keys, config: service().config });
    strict.sessions.allow('chat-c', ['http://169.254.169.254/latest/meta-data/', 'http://127.0.0.1:9/']);
    await rejects(strict.read('chat-c', 'http://169.254.169.254/latest/meta-data/'), 'blocked');
    await rejects(strict.read('chat-c', 'http://127.0.0.1:9/'), 'blocked');
    await rejects(strict.read('chat-c', ''), 'bad_args');
  });

  it('draws the page in a hidden window when it only fills itself in with scripts, and keeps the plain text if that fails', async () => {
    const s = await site({ '/app': '<html><head><title>App</title></head><body><div id="root"></div><script src="/x.js"></script></body></html>' });
    try {
      const rendered = [];
      const web = service({ render: async url => { rendered.push(url); return { url, html: article('drawn by scripts') }; } });
      web.sessions.allow('chat-c', [`${s.url}/app`]);
      assert.match((await web.read('chat-c', `${s.url}/app`)).text, /drawn by scripts/);
      assert.deepEqual(rendered, [`${s.url}/app`]);
      const broken = service({ render: async () => { throw new Error('no window'); } });
      broken.sessions.allow('chat-c', [`${s.url}/app`]);
      assert.match((await broken.read('chat-c', `${s.url}/app`)).text, /^Page: App/);
    } finally { s.close(); }
  });
});

describe('web tools in Code mode', () => {
  const session = (web, options = {}) => new AgentSession({ root: temp(), name: 'demo', approve: async () => 'deny', web, webSession: 'code1', ...options });

  it('are offered, in plan mode too, and need no approval', async () => {
    assert.ok(TOOL_NAMES.includes('web_search') && TOOL_NAMES.includes('fetch_url'));
    assert.ok(PLAN_TOOLS.includes('web_search') && PLAN_TOOLS.includes('fetch_url'));
    const calls = [];
    const web = { search: async (...args) => { calls.push(['search', ...args]); return { text: 'results', display: { kind: 'web_search' } }; }, read: async (...args) => { calls.push(['read', ...args]); return { text: 'page', display: { kind: 'fetch' } }; } };
    const agent = session(web);
    agent.setMode('plan');
    assert.deepEqual(await agent.callTool('web_search', { query: 'q', count: 3 }), { ok: true, text: 'results', display: { kind: 'web_search' } });
    assert.equal((await agent.callTool('fetch_url', { url: 'https://example.com/' })).text, 'page');
    assert.deepEqual(calls, [['search', 'code1', 'q', { count: 3, maxChars: 14000 }], ['read', 'code1', 'https://example.com/', { maxChars: 14000 }]]);
  });

  it('are kept short for a small memory, and fail in words with no web service', async () => {
    const seen = [];
    const web = { search: async (...args) => { seen.push(args); return { text: 'r', display: {} }; } };
    await session(web, { compact: true }).callTool('web_search', { query: 'q' });
    assert.equal(seen[0][2].maxChars, 5000);
    const none = await session(null).callTool('fetch_url', { url: 'https://example.com/' });
    assert.equal(none.ok, false);
    assert.match(none.text, /isn’t available/);
  });

  it('pass a refusal on to the model as words', async () => {
    const { WebError } = require('../../src/web/errors');
    const result = await session({ read: async () => { throw new WebError('not_allowed', 'Quo only opens addresses that came from a search.'); } }).callTool('fetch_url', { url: 'https://evil.example/?x=1' });
    assert.deepEqual([result.ok, result.text], [false, 'Quo only opens addresses that came from a search.']);
  });
});
