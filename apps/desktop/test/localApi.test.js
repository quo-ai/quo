'use strict';

// The local server for other apps (src/server/localApi.js): only apps on this computer with Quo's key, never a web page,
// never another host name, only the chat routes, and llama-server's own key never leaves main. Tries each way in.

const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { after, before, describe, it } = require('node:test');
const { LocalApi } = require('../src/server/localApi');
const { tempDir } = require('./tempdir');

let upstream;
let seen = [];
let api;
let loaded = true;
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

before(async () => {
  // A stand-in llama-server: records what it was sent and answers like the OpenAI API.
  upstream = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      seen.push({ url: req.url, auth: req.headers.authorization, body });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Hello from the model' } }] }));
    });
  });
  const upstreamPort = await listen(upstream);
  api = new LocalApi({
    settingsFile: path.join(tempDir('quo-localapi-'), 'local-api.json'),
    target: () => (loaded ? { origin: `http://127.0.0.1:${upstreamPort}`, key: 'llama-secret' } : null),
    status: () => (loaded ? { running: true, modelId: 'qwen35-4b' } : { running: false }),
  });
  api.saved.port = 0; // any free port, for the test
  await api.start();
});
after(async () => {
  await api.stop();
  upstream.close();
});

const call = (pathname, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const port = api.server.address().port;
  const req = http.request({ host: '127.0.0.1', port, path: pathname, method, headers: { host: `127.0.0.1:${port}`, ...headers } }, res => {
    let text = '';
    res.on('data', chunk => (text += chunk));
    res.on('end', () => resolve({ status: res.statusCode, text }));
  });
  req.on('error', reject);
  if (body) req.write(body);
  req.end();
});
const key = () => ({ authorization: `Bearer ${api.state().key}` });

describe('the local server for other apps', () => {
  it('answers an app with the key: the loaded model, and chat forwarded with llama-server’s own key', async () => {
    const models = await call('/v1/models', { headers: key() });
    assert.equal(models.status, 200);
    assert.deepEqual(JSON.parse(models.text).data.map(model => model.id), ['qwen35-4b']);
    seen = [];
    const chat = await call('/v1/chat/completions', { method: 'POST', headers: { ...key(), 'content-type': 'application/json' }, body: '{"messages":[{"role":"user","content":"hi"}]}' });
    assert.equal(chat.status, 200);
    assert.match(chat.text, /Hello from the model/);
    assert.deepEqual(seen.map(({ url, auth }) => [url, auth]), [['/v1/chat/completions', 'Bearer llama-secret']]);
    assert.equal(chat.text.includes('llama-secret'), false);
  });

  it('refuses web pages, other host names, and a missing or wrong key', async () => {
    assert.equal((await call('/v1/models', { headers: { ...key(), origin: 'https://evil.example' } })).status, 403);
    assert.equal((await call('/v1/models', { headers: { ...key(), origin: 'null' } })).status, 403);
    assert.equal((await call('/v1/models', { headers: { ...key(), host: 'evil.example:1235' } })).status, 403); // DNS rebinding
    assert.equal((await call('/v1/models')).status, 401);
    assert.equal((await call('/v1/models', { headers: { authorization: 'Bearer quo-wrong' } })).status, 401);
    assert.equal((await call('/v1/models', { headers: { authorization: `Basic ${api.state().key}` } })).status, 401);
  });

  it('answers only its routes, takes no huge bodies, and says so when no model is loaded', async () => {
    seen = [];
    for (const [pathname, method] of [['/v1/embeddings', 'POST'], ['/slots', 'GET'], ['/props', 'POST'], ['/v1/chat/completions', 'GET'], ['/../v1/models', 'DELETE']]) {
      assert.equal((await call(pathname, { method, headers: key() })).status, 404, pathname);
    }
    assert.equal((await call('/v1/completions', { method: 'POST', headers: { ...key(), 'content-length': String(17 * 1024 * 1024) }, body: 'x'.repeat(17 * 1024 * 1024) }).catch(error => ({ status: error.code }))).status, 413);
    loaded = false;
    assert.equal((await call('/v1/chat/completions', { method: 'POST', headers: key(), body: '{}' })).status, 503);
    assert.deepEqual(JSON.parse((await call('/v1/models', { headers: key() })).text).data, []);
    loaded = true;
    assert.deepEqual(seen, []); // nothing reached llama-server
  });

  it('can be given a new key, after which the old one stops working', async () => {
    const old = api.state().key;
    await api.renewKey();
    assert.notEqual(api.state().key, old);
    assert.match(api.state().key, /^quo-[0-9a-f]{48}$/);
    assert.equal((await call('/v1/models', { headers: { authorization: `Bearer ${old}` } })).status, 401);
    assert.equal((await call('/v1/models', { headers: key() })).status, 200);
  });
});
