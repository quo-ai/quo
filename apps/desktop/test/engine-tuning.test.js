'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { startWithFallback, MIN_CONTEXT } = require('../src/engine/fallback');
const { IdleWatch, IDLE_MS } = require('../src/engine/idle');
const { serverArgs } = require('../src/engine/llama');

const oom = () => Object.assign(new Error('too big'), { code: 'out_of_memory' });

describe('a model that does not fit with the window asked for', () => {
  it('is loaded again with half the window, until it fits, and says what it tried', async () => {
    const tried = [];
    const retries = [];
    const result = await startWithFallback(async size => {
      tried.push(size);
      if (size > 9000) throw oom();
      return { running: true, contextSize: size };
    }, 32768, { onRetry: (from, to) => retries.push([from, to]) });
    assert.deepEqual(tried, [32768, 16384, 8192]);
    assert.deepEqual(retries, [[32768, 16384], [16384, 8192]]);
    assert.deepEqual(result, { running: true, contextSize: 8192 });
  });

  it('loads at once, with one call, when it fits', async () => {
    let calls = 0;
    const result = await startWithFallback(async size => (calls++, { contextSize: size }), 32768);
    assert.equal(calls, 1);
    assert.equal(result.contextSize, 32768);
  });

  it('never goes below what a chat needs, and then gives the real error', async () => {
    const tried = [];
    await assert.rejects(startWithFallback(async size => (tried.push(size), Promise.reject(oom())), 32768), error => error.code === 'out_of_memory');
    assert.equal(Math.min(...tried), MIN_CONTEXT);
    assert.equal(tried.at(-1), MIN_CONTEXT);
    const small = [];
    await assert.rejects(startWithFallback(async size => (small.push(size), Promise.reject(oom())), 4096), error => error.code === 'out_of_memory');
    assert.deepEqual(small, [4096], 'a window already below the minimum is not retried');
  });

  it('keeps the window to whole thousands, and retries only out-of-memory', async () => {
    const tried = [];
    await assert.rejects(startWithFallback(async size => (tried.push(size), Promise.reject(oom())), 20000));
    assert.ok(tried.every(size => size % 1024 === 0 || size === 20000));
    for (const code of ['unsupported_model', 'load_failed', 'engine_failed', undefined]) {
      let calls = 0;
      await assert.rejects(startWithFallback(async () => (calls++, Promise.reject(Object.assign(new Error('x'), { code }))), 32768));
      assert.equal(calls, 1, String(code));
    }
  });
});

describe('letting go of a model nobody is using', () => {
  const clock = () => {
    let t = 1_000_000;
    return { now: () => t, advance: ms => (t += ms) };
  };

  it('waits the whole idle time, then says so once it is idle', () => {
    const c = clock();
    const watch = new IdleWatch({ idleMs: 60_000, now: c.now, onIdle: () => {} });
    assert.equal(watch.isIdle(), false);
    c.advance(59_000);
    assert.equal(watch.isIdle(), false);
    c.advance(1_000);
    assert.equal(watch.isIdle(), true);
  });

  it('is never idle while a request is going, however long it runs, and starts counting again when it ends', () => {
    const c = clock();
    const watch = new IdleWatch({ idleMs: 60_000, now: c.now, onIdle: () => {} });
    watch.begin();
    c.advance(10 * 60_000);
    assert.equal(watch.isIdle(), false, 'a long reply is not idle time');
    watch.end();
    assert.equal(watch.isIdle(), false, 'the clock starts again from the end of the reply');
    c.advance(60_000);
    assert.equal(watch.isIdle(), true);
  });

  it('counts overlapping requests, and never goes below none', () => {
    const c = clock();
    const watch = new IdleWatch({ idleMs: 1000, now: c.now, onIdle: () => {} });
    watch.begin();
    watch.begin();
    watch.end();
    c.advance(5000);
    assert.equal(watch.isIdle(), false);
    watch.end();
    watch.end(); // one too many
    c.advance(1000);
    assert.equal(watch.isIdle(), true);
    watch.begin();
    assert.equal(watch.isIdle(), false);
  });

  it('calls for the unload only when idle, and stops looking when asked', async () => {
    let unloaded = 0;
    const watch = new IdleWatch({ idleMs: 20, onIdle: () => unloaded++ });
    watch.start(5);
    watch.begin();
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(unloaded, 0, 'busy: not unloaded');
    watch.end();
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.ok(unloaded >= 1, 'idle: unloaded');
    watch.stop();
    const after = unloaded;
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(unloaded, after, 'stopped: no more calls');
  });

  it('waits half an hour by default', () => {
    assert.equal(IDLE_MS, 30 * 60 * 1000);
  });
});

describe('how llama-server is started', () => {
  const args = serverArgs({ modelPath: '/m/model.gguf', mmprojPath: null, port: 8123, key: 'k', contextSize: 16384 });
  const value = flag => args[args.indexOf(flag) + 1];

  it('never reaches for the network, and listens on this computer only, with a key', () => {
    assert.ok(args.includes('--offline'));
    assert.equal(value('--host'), '127.0.0.1');
    assert.equal(value('--api-key'), 'k');
    assert.equal(value('--port'), '8123');
  });

  it('uses the window it was given, one slot, the model’s own chat template, and no web page', () => {
    assert.equal(value('-c'), '16384');
    assert.equal(value('--parallel'), '1');
    assert.ok(args.includes('--jinja') && args.includes('--no-webui'));
  });

  it('leaves GPU layers, flash attention and the rest to llama-server’s own choices (pinning them OOMs small GPUs)', () => {
    for (const flag of ['-ngl', '--gpu-layers', '--n-gpu-layers', '-fa', '--flash-attn', '-ctk', '-ctv', '--no-mmap', '--mlock', '-b', '-ub', '-t', '--fit']) assert.ok(!args.includes(flag), flag);
  });

  it('adds the picture projector only when there is one', () => {
    assert.ok(!args.includes('--mmproj'));
    const withVision = serverArgs({ modelPath: '/m/model.gguf', mmprojPath: '/m/mmproj.gguf', port: 1, key: 'k', contextSize: 8192 });
    assert.equal(withVision[withVision.indexOf('--mmproj') + 1], '/m/mmproj.gguf');
  });
});
