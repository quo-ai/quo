'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { describe, it } = require('node:test');
const { Endpoints } = require('../../src/providers/endpoints');
const { KeyStore } = require('../../src/providers/keystore');
const { ProviderRequests } = require('../../src/providers/requests');
const { collector, fakeSafeStorage, server, temp, wait } = require('./helpers');

const KEY = `${'sk'}-${'test'}-${'abcdefghijkl1234'}`;
const rejects = (promise, code) => assert.rejects(promise, error => error.code === code, `expected ${code}`);

async function setup({ limits, fetchFn } = {}) {
  const dir = temp();
  const keys = new KeyStore({ file: path.join(dir, 'keys.json'), safeStorage: fakeSafeStorage() });
  const endpoints = new Endpoints(path.join(dir, 'endpoints.json'));
  const requests = new ProviderRequests({ keys, endpoints, limits, ...(fetchFn ? { fetchFn } : {}) });
  /** A custom server at `url`, with a key unless told not to. */
  const addServer = async (url, { protocol = 'openai', key = KEY } = {}) => {
    const { entry } = await endpoints.save({ name: 'Local', baseUrl: url, protocol });
    if (key) await keys.set(entry.id, key);
    return entry.id;
  };
  return { keys, endpoints, requests, addServer };
}

const chat = (providerId, extra = {}) => ({ id: `req-${Math.random().toString(16).slice(2, 12)}`, providerId, method: 'POST', path: '/chat/completions', body: { model: 'm', messages: [] }, ...extra });
const run = async (requests, request) => {
  const out = collector();
  await requests.start(request, out.emit);
  await out.finished;
  return out;
};

describe('requests to a provider on the page’s behalf', () => {
  it('adds the key itself, sends the body as it was given, and streams the answer back', async () => {
    const s = await server((_req, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: one\n\n'); setTimeout(() => res.end('data: two\n\n'), 20); });
    try {
      const { requests, addServer } = await setup();
      const id = await addServer(s.url);
      const out = await run(requests, chat(id, { body: { model: 'gpt-x', messages: [{ role: 'user', content: 'hi' }] } }));
      assert.deepEqual(out.events.map(e => e.type).filter((t, i, all) => all.indexOf(t) === i), ['head', 'chunk', 'end']);
      assert.equal(out.events[0].status, 200);
      assert.equal(out.text(), 'data: one\n\ndata: two\n\n');
      const [seen] = s.seen;
      assert.equal(seen.method, 'POST');
      assert.equal(seen.url, '/chat/completions');
      assert.equal(seen.headers.authorization, `Bearer ${KEY}`);
      assert.equal(seen.headers['content-type'], 'application/json');
      assert.deepEqual(JSON.parse(seen.body), { model: 'gpt-x', messages: [{ role: 'user', content: 'hi' }] });
    } finally { s.close(); }
  });

  it('uses Anthropic’s way of carrying the key for servers that speak it', async () => {
    const s = await server((_req, res) => res.end('{}'));
    try {
      const { requests, addServer } = await setup();
      const id = await addServer(s.url, { protocol: 'anthropic' });
      await run(requests, chat(id, { path: '/messages' }));
      assert.equal(s.seen[0].headers['x-api-key'], KEY);
      assert.equal(s.seen[0].headers['anthropic-version'], '2023-06-01');
      assert.equal(s.seen[0].headers.authorization, undefined);
    } finally { s.close(); }
  });

  it('sends a built-in provider’s requests to its own address, whatever else the page says', async () => {
    const calls = [];
    const { requests, keys } = await setup({ fetchFn: async (url, init) => { calls.push({ url, init }); return new Response('{}', { status: 200 }); } });
    await keys.set('openai', KEY);
    await run(requests, { ...chat('openai'), url: 'https://evil.example.com/steal', baseUrl: 'https://evil.example.com', headers: { authorization: 'Bearer other' } });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(calls[0].init.headers.authorization, `Bearer ${KEY}`);
    assert.equal(calls[0].init.redirect, 'manual');
  });

  it('forwards an error answer too, so the page can say what the provider said', async () => {
    const s = await server((_req, res) => { res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"error":{"message":"bad key"}}'); });
    try {
      const { requests, addServer } = await setup();
      const out = await run(requests, chat(await addServer(s.url)));
      assert.equal(out.events[0].status, 401);
      assert.match(out.text(), /bad key/);
    } finally { s.close(); }
  });

  it('allows a custom server without a key, but not a built-in provider', async () => {
    const s = await server((_req, res) => res.end('{}'));
    try {
      const { requests, addServer } = await setup();
      await run(requests, chat(await addServer(s.url, { key: null })));
      assert.equal(s.seen[0].headers.authorization, undefined);
      await rejects(requests.start(chat('openai'), () => {}), 'no_key');
    } finally { s.close(); }
  });
});

describe('what a request may ask for', () => {
  it('refuses other paths and methods, unknown providers, bad ids, and bodies that aren’t objects', async () => {
    const { requests, keys } = await setup();
    await keys.set('openai', KEY);
    for (const bad of [
      chat('openai', { path: '/embeddings' }), chat('openai', { path: '/chat/completions?x=1' }), chat('openai', { path: '//evil.com/chat/completions' }), chat('openai', { method: 'GET' }),
      chat('openai', { method: 'DELETE', path: '/models' }), chat('openai', { body: 'text' }), chat('openai', { body: [1] }), chat('openai', { body: null }),
    ]) await rejects(requests.start(bad, () => {}), 'bad_request');
    await rejects(requests.start(chat('nope'), () => {}), 'unknown_provider');
    await rejects(requests.start(chat('custom-abcdef'), () => {}), 'unknown_provider');
    for (const id of ['', 'short', 'has space here', 'a'.repeat(65), 'bad/id/slash', null, 7]) await rejects(requests.start(chat('openai', { id }), () => {}), 'bad_request');
  });

  it('refuses a conversation that is too large, and too many at once, and a request id that is already running', async () => {
    const s = await server(() => {});
    try {
      const { requests, addServer } = await setup({ limits: { maxBodyBytes: 200, maxActive: 2 } });
      const id = await addServer(s.url);
      await rejects(requests.start(chat(id, { body: { text: 'x'.repeat(300) } }), () => {}), 'too_large');
      const first = chat(id);
      await requests.start(first, () => {});
      await rejects(requests.start({ ...chat(id), id: first.id }, () => {}), 'bad_request');
      await requests.start(chat(id), () => {});
      await rejects(requests.start(chat(id), () => {}), 'busy');
      requests.abortAll();
    } finally { s.close(); }
  });
});

describe('keeping the key where it belongs', () => {
  it('doesn’t follow a redirect, which would carry the key to another host', async () => {
    const target = await server((_req, res) => res.end('stolen'));
    const redirecting = await server((_req, res) => { res.writeHead(307, { location: `${target.url}/chat/completions` }); res.end(); });
    try {
      const { requests, addServer } = await setup();
      const out = await run(requests, chat(await addServer(redirecting.url)));
      assert.equal(out.events.at(-1).type, 'error');
      assert.match(out.events.at(-1).message, /redirect/i);
      assert.ok(!out.events.some(e => e.type === 'head' || e.type === 'chunk'));
      await wait(50);
      assert.equal(target.seen.length, 0, 'the other host must never be contacted');
    } finally { target.close(); redirecting.close(); }
  });

  it('says plainly that a redirect was refused when the HTTP stack reports it as a failure', async () => {
    for (const message of ['Redirect was cancelled', 'fetch failed: unexpected redirect']) {
      const { requests, keys } = await setup({ fetchFn: async () => { throw new TypeError(message); } });
      await keys.set('openai', KEY);
      const out = await run(requests, chat('openai'));
      assert.match(out.events.at(-1).message, /redirected the request/);
    }
  });

  it('never puts the key in an error it sends back', async () => {
    const { requests, keys } = await setup({ fetchFn: async () => { throw Object.assign(new Error(`connect failed for ${KEY}`), { cause: { code: 'ECONNREFUSED' } }); } });
    await keys.set('openai', KEY);
    const out = await run(requests, chat('openai'));
    assert.equal(out.events.at(-1).type, 'error');
    assert.ok(!JSON.stringify(out.events).includes(KEY.slice(3)));
    assert.match(out.events.at(-1).message, /ECONNREFUSED/);
  });
});

describe('ending a request', () => {
  it('stops when told to, closes the connection, and sends nothing more', async () => {
    const s = await server((_req, res) => { res.writeHead(200); res.write('start\n'); });
    try {
      const { requests, addServer } = await setup();
      const out = collector();
      const request = chat(await addServer(s.url));
      await requests.start(request, out.emit);
      while (!out.events.some(e => e.type === 'chunk')) await wait(10);
      requests.abort(request.id);
      await wait(100);
      assert.ok(!out.events.some(e => e.type === 'end' || e.type === 'error'), 'the page already knows it stopped');
      assert.equal(s.seen[0].closed, true);
      assert.equal(requests.active.size, 0);
      requests.abort('not-running-id'); // harmless
    } finally { s.close(); }
  });

  it('gives up on a provider that goes silent', async () => {
    const s = await server(() => {});
    try {
      const { requests, addServer } = await setup({ limits: { idleMs: 80 } });
      const out = await run(requests, chat(await addServer(s.url)));
      assert.match(out.events.at(-1).message, /stopped responding/);
      assert.equal(requests.active.size, 0);
    } finally { s.close(); }
  });

  it('cuts off an answer that is far too large', async () => {
    const s = await server((_req, res) => { res.writeHead(200); res.write('x'.repeat(5000)); res.write('y'.repeat(5000)); setTimeout(() => res.end(), 500); });
    try {
      const { requests, addServer } = await setup({ limits: { maxResponseBytes: 4000 } });
      const out = await run(requests, chat(await addServer(s.url)));
      assert.match(out.events.at(-1).message, /too large/);
    } finally { s.close(); }
  });

  it('says it couldn’t connect, plainly, when nothing is listening', async () => {
    const dead = await server(() => {});
    const url = dead.url;
    dead.close();
    const { requests, addServer } = await setup();
    const out = await run(requests, chat(await addServer(url)));
    assert.match(out.events.at(-1).message, /Couldn’t connect/);
  });
});
