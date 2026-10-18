'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const { KeyStore } = require('../../src/web/../providers/keystore');
const { WebConfig } = require('../../src/web/config');
const { parseDuckDuckGo, search } = require('../../src/web/search');
const { WebService } = require('../../src/web/service');
const { fakeSafeStorage, temp } = require('../providers/helpers');

const KEY = `${'brave'}-${'test'}-${'abcdefghijkl1234'}`;
const reply = (body, status = 200) => async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
const rejects = (promise, code) => assert.rejects(promise, error => error.code === code, `expected ${code}`);

const DUCK = `<div class="result"><h2 class="result__title"><a rel="nofollow" class="result__a" href="https://github.com/ggml-org/llama.cpp/blob/master/docs/function-calling.md">llama.cpp/docs/function-calling.md at master - GitHub</a></h2>
  <a class="result__snippet" href="https://github.com/x">Native support for <b>tool</b> calling &amp; more.</a></div>
  <div class="result result--ad"><a rel="nofollow" class="result__a" href="https://duckduckgo.com/y.js?ad=1">Buy stuff</a><a class="result__snippet" href="x">ad</a></div>
  <div class="result"><h2><a class="result__a" rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1&amp;rut=abc">Wrapped &amp; result</a></h2><a class="result__snippet" href="x">Second</a></div>`;

describe('search services', () => {
  it('Brave: asks with the key, and reads the results', async () => {
    let call;
    const results = await search('brave', { query: 'cats & dogs', count: 5, key: KEY, fetchFn: async (url, init) => { call = { url, init }; return new Response(JSON.stringify({ web: { results: [{ title: 'A <b>cat</b>', url: 'https://a.example/', description: 'About cats' }, { title: 'No url', url: 'javascript:x' }] } })); } });
    assert.deepEqual(results, [{ title: 'A cat', url: 'https://a.example/', snippet: 'About cats' }]);
    assert.equal(call.url, 'https://api.search.brave.com/res/v1/web/search?q=cats%20%26%20dogs&count=5');
    assert.equal(call.init.headers['x-subscription-token'], KEY);
  });

  it('Tavily and Exa: send the query in the body with the key in the header they use', async () => {
    const calls = [];
    const fetchFn = async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify({ results: [{ title: 'T', url: 'https://t.example/', content: 'c', text: 'x' }] })); };
    assert.equal((await search('tavily', { query: 'q', count: 3, key: 'tvly-secretsecret', fetchFn }))[0].snippet, 'c');
    assert.equal((await search('exa', { query: 'q', count: 3, key: 'exa-secretsecret', fetchFn }))[0].snippet, 'x');
    assert.equal(calls[0].init.headers.authorization, 'Bearer tvly-secretsecret');
    assert.deepEqual(JSON.parse(calls[0].init.body), { query: 'q', max_results: 3, search_depth: 'basic' });
    assert.equal(calls[1].init.headers['x-api-key'], 'exa-secretsecret');
    assert.equal(JSON.parse(calls[1].init.body).numResults, 3);
  });

  it('SearXNG: uses the address it was given, and says what to change if JSON is off', async () => {
    let url;
    const ok = await search('searxng', { query: 'a b', count: 1, url: 'http://localhost:8080', fetchFn: async u => { url = u; return new Response(JSON.stringify({ results: [{ title: 'One', url: 'https://one.example/', content: 'x' }, { title: 'Two', url: 'https://two.example/' }] })); } });
    assert.equal(ok.length, 1);
    assert.equal(url, 'http://localhost:8080/search?q=a%20b&format=json');
    await assert.rejects(search('searxng', { query: 'q', count: 1, url: 'http://localhost:8080', fetchFn: reply('no', 403) }), error => /JSON/.test(error.message));
  });

  it('DuckDuckGo: reads the page, undoes redirect links, and skips adverts', () => {
    const results = parseDuckDuckGo(DUCK, 10);
    assert.deepEqual(results.map(r => r.url), ['https://github.com/ggml-org/llama.cpp/blob/master/docs/function-calling.md', 'https://example.com/a?b=1']);
    assert.equal(results[0].snippet, 'Native support for tool calling & more.');
    assert.equal(results[1].title, 'Wrapped & result');
    assert.equal(parseDuckDuckGo(DUCK, 1).length, 1);
    assert.throws(() => parseDuckDuckGo('<html>Our systems detected unusual traffic. captcha</html>', 5), error => error.code === 'blocked');
    assert.deepEqual(parseDuckDuckGo('<html>nothing</html>', 5), []);
  });

  it('turns failures into words', async () => {
    const run = fetchFn => search('brave', { query: 'q', count: 1, key: KEY, fetchFn });
    await rejects(run(reply('', 401)), 'auth');
    await rejects(run(reply('', 429)), 'limit');
    await rejects(run(reply('', 402)), 'limit');
    await rejects(run(reply('', 500)), 'failed');
    await rejects(run(reply('<html>', 200)), 'failed');
    await rejects(run(async () => { throw new TypeError('fetch failed'); }), 'unreachable');
  });
});

describe('choosing a service', () => {
  async function setup(fetchFn, backend = 'auto', saved = {}) {
    const dir = temp();
    const keys = new KeyStore({ file: path.join(dir, 'keys.json'), safeStorage: fakeSafeStorage() });
    for (const [id, key] of Object.entries(saved)) await keys.set(`web:${id}`, key);
    const config = new WebConfig(path.join(dir, 'web.json'));
    await config.set({ backend });
    return { service: new WebService({ keys, config, fetchFn }), config, keys };
  }
  const brave = { web: { results: [{ title: 'Brave result', url: 'https://b.example/', description: 'd' }] } };

  it('automatic: a service with a key first, then DuckDuckGo', async () => {
    const urls = [];
    const { service } = await setup(async url => { urls.push(url); return new Response(url.includes('brave') ? JSON.stringify(brave) : DUCK); }, 'auto', { brave: KEY });
    assert.match((await service.search('s1', 'x')).text, /\(Brave Search\)/);
    const none = await setup(async url => { urls.push(url); return new Response(DUCK); });
    assert.match((await none.service.search('s1', 'x')).text, /\(DuckDuckGo\)/);
  });

  it('automatic: falls back to the next one when the first fails, and says which answered', async () => {
    const { service } = await setup(async url => (url.includes('brave') ? new Response('', { status: 429 }) : new Response(DUCK)), 'auto', { brave: KEY });
    const result = await service.search('s1', 'x');
    assert.match(result.text, /\(DuckDuckGo\)/);
    assert.equal(result.display.backend, 'DuckDuckGo');
  });

  it('a chosen service is the only one used, and says what is missing', async () => {
    const { service } = await setup(async () => new Response(DUCK), 'brave');
    await rejects(service.search('s1', 'x'), 'no_key');
    const failing = await setup(async () => new Response('', { status: 401 }), 'brave', { brave: KEY });
    await rejects(failing.service.search('s1', 'x'), 'auth');
    const searx = await setup(async () => new Response('{}'), 'searxng');
    await rejects(searx.service.search('s1', 'x'), 'no_url');
  });

  it('takes secrets out of the query, and refuses an empty one', async () => {
    let asked;
    const { service } = await setup(async url => { asked = url; return new Response(DUCK); });
    await service.search('s1', `how to use ${'gh'}${'p_'}${'a'.repeat(36)} in git`);
    assert.ok(!asked.includes('ghp_'));
    await rejects(service.search('s1', '   '), 'bad_args');
  });

  it('describes what is set up, without any key', async () => {
    const { service, config } = await setup(async () => new Response(DUCK), 'auto', { tavily: KEY });
    await config.set({ searxngUrl: 'http://localhost:8080' });
    const state = await service.state();
    assert.equal(state.backend, 'auto');
    const byId = Object.fromEntries(state.backends.map(b => [b.id, b]));
    assert.deepEqual([byId.tavily.configured, byId.tavily.last4, byId.brave.configured, byId.searxng.configured, byId.duckduckgo.configured], [true, '1234', false, true, true]);
    assert.ok(!JSON.stringify(state).includes(KEY));
  });

  it('keeps the settings tidy: known services, safe addresses', async () => {
    const { config } = await setup(async () => new Response(DUCK));
    await rejects(config.set({ backend: 'google' }), 'bad_args');
    await rejects(config.set({ searxngUrl: 'http://example.com' }), 'bad_url');
    assert.equal((await config.set({ searxngUrl: 'https://s.example.com/' })).searxngUrl, 'https://s.example.com');
    assert.equal((await config.set({ searxngUrl: '' })).searxngUrl, null);
    fs.writeFileSync(config.file, '{broken');
    assert.deepEqual(await config.get(), { backend: 'auto', searxngUrl: null });
  });
});
