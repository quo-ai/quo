'use strict';

// Speculative decoding (a prediction head, a drafter file, n-gram lookup) and the 8-bit window: what llama-server is
// started with, when a drafter counts, and the fallback when a device can't hold an 8-bit window.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const { serverArgs } = require('../src/engine/llama');
const { startWithCache } = require('../src/engine/fallback');
const { ModelStore } = require('../src/engine/models');
const { tempDir } = require('./tempdir');

const base = { modelPath: '/m/model.gguf', mmprojPath: null, port: 1, key: 'k', contextSize: 16384 };
const value = (args, flag) => args[args.indexOf(flag) + 1];

describe('drafting several tokens a step', () => {
  it('uses the model’s own prediction head when the file has one, three tokens a step, with n-gram lookup', () => {
    const args = serverArgs({ ...base, mtp: true });
    assert.equal(value(args, '--spec-type'), 'draft-mtp,ngram-map-k');
    assert.equal(value(args, '--spec-draft-n-max'), '3');
    assert.ok(!args.includes('--spec-draft-model'));
  });

  it('uses a drafter file beside the model when there is one, four tokens a step, with n-gram lookup', () => {
    const args = serverArgs({ ...base, draftPath: '/m/draft.gguf' });
    assert.equal(value(args, '--spec-draft-model'), '/m/draft.gguf');
    assert.equal(value(args, '--spec-type'), 'draft-mtp,ngram-map-k');
    assert.equal(value(args, '--spec-draft-n-max'), '4');
    assert.equal(args.filter(arg => arg === '--spec-type').length, 1, 'one speculative setting, even when the file also has a head');
    assert.equal(serverArgs({ ...base, draftPath: '/m/draft.gguf', mtp: true }).filter(arg => arg === '--spec-type').length, 1);
  });

  it('never drafts by n-gram alone: without a head or a drafter it slowed new code by a third', () => {
    for (const args of [serverArgs(base), serverArgs({ ...base, mtp: false }), serverArgs({ ...base, draftPath: null })]) {
      assert.ok(!args.includes('--spec-type'));
      assert.ok(!args.includes('--spec-draft-model'));
    }
  });
});

describe('the 8-bit window', () => {
  it('is asked of llama-server only when the app asks for it, for both halves of the cache', () => {
    const args = serverArgs({ ...base, kvType: 'q8_0' });
    assert.equal(value(args, '-ctk'), 'q8_0');
    assert.equal(value(args, '-ctv'), 'q8_0');
    for (const kvType of [undefined, 'f16', 'q4_0', 'nonsense']) assert.ok(!serverArgs({ ...base, kvType }).includes('-ctk'), String(kvType));
  });

  it('falls back to 16 bits when an 8-bit start fails, but not for a missing model, and never retries a 16-bit failure', async () => {
    const tried = [];
    const ok = await startWithCache(async cache => {
      tried.push(cache);
      if (cache === 'q8_0') throw Object.assign(new Error('flash attention needed'), { code: 'engine_failed' });
      return { kvType: cache };
    }, 'q8_0');
    assert.deepEqual(ok, { kvType: 'f16' });
    assert.deepEqual(tried, ['q8_0', 'f16']);

    const missing = [];
    await assert.rejects(startWithCache(async cache => (missing.push(cache), Promise.reject(Object.assign(new Error('gone'), { code: 'model_missing' }))), 'q8_0'), error => error.code === 'model_missing');
    assert.deepEqual(missing, ['q8_0']);

    const plain = [];
    await assert.rejects(startWithCache(async cache => (plain.push(cache), Promise.reject(new Error('no'))), 'f16'));
    assert.deepEqual(plain, ['f16']);
    const odd = [];
    await startWithCache(async cache => (odd.push(cache), {}), 'q4_0');
    assert.deepEqual(odd, ['f16'], 'anything but q8_0 means the ordinary window');
  });
});

describe('a drafter file', () => {
  const gguf = size => Buffer.concat([Buffer.from('GGUF'), Buffer.alloc(size - 4)]);
  const files = [{ name: 'model.gguf', sizeBytes: 2000 }, { name: 'draft.gguf', sizeBytes: 300, optional: true }];

  it('does not decide whether the model is installed: with or without it, the model is there', async () => {
    const dir = tempDir('quo-draft-');
    const store = new ModelStore({ directory: dir, customFile: path.join(dir, 'custom.json'), emit: () => {} });
    fs.mkdirSync(path.join(dir, 'g'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'g', 'model.gguf'), gguf(2000));
    assert.deepEqual(await store.state('g', files), { installed: true, downloadedBytes: 2000, totalBytes: 2000 });
    fs.writeFileSync(path.join(dir, 'g', 'draft.gguf'), gguf(300));
    assert.deepEqual(await store.state('g', files), { installed: true, downloadedBytes: 2300, totalBytes: 2300 });
  });

  it('still needs the model itself, and only a flag that is exactly true makes a file optional', async () => {
    const dir = tempDir('quo-draft-');
    const store = new ModelStore({ directory: dir, customFile: path.join(dir, 'custom.json'), emit: () => {} });
    fs.mkdirSync(path.join(dir, 'g'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'g', 'draft.gguf'), gguf(300));
    assert.equal((await store.state('g', files)).installed, false);
    fs.writeFileSync(path.join(dir, 'g', 'model.gguf'), gguf(2000));
    assert.equal((await store.state('g', [files[0], { ...files[1], optional: 'yes', sizeBytes: 999 }])).installed, false);
  });
});
