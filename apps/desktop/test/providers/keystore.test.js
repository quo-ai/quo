'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const { Endpoints } = require('../../src/providers/endpoints');
const { KeyStore } = require('../../src/providers/keystore');
const { fakeSafeStorage, temp } = require('./helpers');

// Built at run time so no real-looking key sits in the source.
const KEY = `${'sk'}-${'test'}-${'abcdefghijkl1234'}`;
const store = (dir, safeStorage = fakeSafeStorage()) => new KeyStore({ file: path.join(dir, 'keys.json'), safeStorage });
const rejects = (promise, code) => assert.rejects(promise, error => error.code === code, `expected ${code}`);

describe('saving API keys', () => {
  it('keeps a key encrypted on disk, and finds it again later', async () => {
    const dir = temp();
    await store(dir).set('openai', KEY);
    const text = fs.readFileSync(path.join(dir, 'keys.json'), 'utf8');
    assert.ok(!text.includes(KEY) && !text.includes(KEY.slice(3)), 'the file must not hold the key in the clear');
    assert.equal(await store(dir).get('openai'), KEY);
    assert.deepEqual(await store(dir).states(['openai', 'groq']), [{ id: 'openai', configured: true, last4: '1234' }, { id: 'groq', configured: false, last4: null }]);
    if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir, 'keys.json')).mode & 0o077, 0, 'only the owner may read it');
  });

  it('replaces and clears keys', async () => {
    const dir = temp();
    const keys = store(dir);
    await keys.set('openai', KEY);
    await keys.set('openai', `${KEY}-two`);
    assert.equal(await store(dir).get('openai'), `${KEY}-two`);
    await keys.clear('openai');
    assert.equal(await store(dir).get('openai'), null);
    await keys.clear('openai'); // nothing there: fine
  });

  it('refuses things that aren’t keys, such as text with spaces or line breaks, which could carry other headers', async () => {
    const keys = store(temp());
    for (const bad of ['', 'short', 'has space in it 12345', `${KEY}\nx-evil: 1`, `${KEY}\r\nx-evil: 1`, 'ключ-ключ-ключ-ключ', 'x'.repeat(501), null, undefined, 123]) {
      await rejects(keys.set('openai', bad), 'bad_key');
    }
    assert.equal(await keys.get('openai'), null);
    await keys.set('openai', `  ${KEY}  `);
    assert.equal(await keys.get('openai'), KEY, 'surrounding spaces are trimmed');
  });

  it('keeps keys in memory only, and writes nothing, where the system has no secure storage', async () => {
    for (const safe of [fakeSafeStorage('basic_text'), fakeSafeStorage('unknown'), fakeSafeStorage('gnome_libsecret', false), null]) {
      const dir = temp();
      const keys = store(dir, safe);
      assert.equal(keys.secure, false);
      await keys.set('openai', KEY);
      assert.equal(await keys.get('openai'), KEY);
      assert.equal(fs.existsSync(path.join(dir, 'keys.json')), false);
      assert.equal(await store(dir, safe).get('openai'), null, 'gone after a restart');
    }
  });

  it('treats a key it can’t decrypt as not saved, and a damaged file as empty', async () => {
    const dir = temp();
    fs.writeFileSync(path.join(dir, 'keys.json'), JSON.stringify({ keys: { openai: Buffer.from('garbage').toString('base64') } }));
    assert.equal(await store(dir).get('openai'), null);
    fs.writeFileSync(path.join(dir, 'keys.json'), '{not json');
    assert.equal(await store(dir).get('openai'), null);
    await store(dir).set('openai', KEY);
    assert.equal(await store(dir).get('openai'), KEY);
  });
});

describe('servers the user adds', () => {
  const entry = { name: 'Ollama', baseUrl: 'http://localhost:11434/v1/', protocol: 'openai' };

  it('saves, lists and removes them, with a clean address and a generated id', async () => {
    const endpoints = new Endpoints(path.join(temp(), 'endpoints.json'));
    const { entry: saved, changed } = await endpoints.save(entry);
    assert.match(saved.id, /^custom-[0-9a-f]{8}$/);
    assert.equal(saved.baseUrl, 'http://localhost:11434/v1');
    assert.equal(changed, false);
    assert.deepEqual(await endpoints.list(), [saved]);
    assert.deepEqual(await endpoints.get(saved.id), saved);
    await endpoints.remove(saved.id);
    assert.deepEqual(await endpoints.list(), []);
  });

  it('says when an address or format changed, because the key must not follow it', async () => {
    const endpoints = new Endpoints(path.join(temp(), 'endpoints.json'));
    const { entry: first } = await endpoints.save(entry);
    assert.equal((await endpoints.save({ ...entry, id: first.id, name: 'Renamed' })).changed, false);
    assert.equal((await endpoints.save({ ...entry, id: first.id, baseUrl: 'https://elsewhere.example.com/v1' })).changed, true);
    assert.equal((await endpoints.save({ ...entry, id: first.id, baseUrl: 'https://elsewhere.example.com/v1', protocol: 'anthropic' })).changed, true);
    assert.equal((await endpoints.list()).length, 1);
  });

  it('refuses unsafe addresses, unknown formats, empty names, unknown ids and too many servers', async () => {
    const endpoints = new Endpoints(path.join(temp(), 'endpoints.json'));
    await rejects(endpoints.save({ ...entry, baseUrl: 'http://example.com/v1' }), 'bad_url');
    await rejects(endpoints.save({ ...entry, baseUrl: 'https://user:pw@example.com' }), 'bad_url');
    await rejects(endpoints.save({ ...entry, baseUrl: 'file:///etc' }), 'bad_url');
    await rejects(endpoints.save({ ...entry, protocol: 'gopher' }), 'bad_protocol');
    await rejects(endpoints.save({ ...entry, name: ' \n ' }), 'bad_name');
    await rejects(endpoints.save({ ...entry, id: 'custom-abcdef' }), 'unknown_provider');
    for (let i = 0; i < 10; i++) await endpoints.save({ ...entry, name: `S${i}` });
    await rejects(endpoints.save(entry), 'too_many');
  });

  it('ignores entries that were edited by hand into something unsafe', async () => {
    const file = path.join(temp(), 'endpoints.json');
    fs.writeFileSync(file, JSON.stringify({ endpoints: [
      { id: 'custom-abcdef', name: 'ok', baseUrl: 'http://localhost:1234/v1', protocol: 'openai' },
      { id: 'custom-badbad', name: 'bad', baseUrl: 'http://evil.example.com/v1', protocol: 'openai' },
      { id: 'openai', name: 'steal', baseUrl: 'https://evil.example.com', protocol: 'openai' },
      { id: 'custom-abcdeg', name: 'x', baseUrl: 'https://a.example.com/v1/', protocol: 'openai' },
    ] }));
    assert.deepEqual((await new Endpoints(file).list()).map(e => e.id), ['custom-abcdef']);
  });
});
