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
    // (The window is stored in 8 bits only when the app asks for it: engine-speed.test.js.)
    for (const flag of ['-ngl', '--gpu-layers', '--n-gpu-layers', '-fa', '--flash-attn', '-ctk', '-ctv', '--no-mmap', '--mlock', '-b', '-ub', '-t', '--fit']) assert.ok(!args.includes(flag), flag);
  });

  it('adds the picture projector only when there is one', () => {
    assert.ok(!args.includes('--mmproj'));
    const withVision = serverArgs({ modelPath: '/m/model.gguf', mmprojPath: '/m/mmproj.gguf', port: 1, key: 'k', contextSize: 8192 });
    assert.equal(withVision[withVision.indexOf('--mmproj') + 1], '/m/mmproj.gguf');
  });
});

describe('a model with images that does not fit: projector first, then window', () => {
  it('keeps the image projector on the processor before it shrinks the window', async () => {
    const calls = [];
    const result = await startWithFallback(async (size, options) => {
      calls.push([size, options.cpuProjector]);
      if (!options.cpuProjector) throw oom();
      return { contextSize: size, cpuProjector: options.cpuProjector };
    }, 32768, { hasProjector: true });
    assert.deepEqual(calls, [[32768, false], [32768, true]]);
    assert.deepEqual(result, { contextSize: 32768, cpuProjector: true });
  });

  it('then halves the window with the projector on the processor, and says what it did each time', async () => {
    const calls = [];
    const retries = [];
    await startWithFallback(async (size, options) => {
      calls.push([size, options.cpuProjector]);
      if (size > 16384) throw oom();
      return {};
    }, 65536, { hasProjector: true, onRetry: (from, to, what) => retries.push([from, to, what]) });
    assert.deepEqual(calls, [[65536, false], [65536, true], [32768, true], [16384, true]]);
    assert.deepEqual(retries, [[65536, 65536, 'projector'], [65536, 32768, 'window'], [32768, 16384, 'window']]);
  });

  it('never touches the projector for a model without one, and gives up at the minimum with the real error', async () => {
    const calls = [];
    await assert.rejects(startWithFallback(async (size, options) => (calls.push([size, options.cpuProjector]), Promise.reject(oom())), 16384, { hasProjector: false }), error => error.code === 'out_of_memory');
    assert.deepEqual(calls, [[16384, false], [8192, false]]);
    const withImages = [];
    await assert.rejects(startWithFallback(async (size, options) => (withImages.push([size, options.cpuProjector]), Promise.reject(oom())), 8192, { hasProjector: true }));
    assert.deepEqual(withImages, [[8192, false], [8192, true]]);
  });
});

describe('the speed-up for models with a prediction head', () => {
  const base = { modelPath: '/m/model.gguf', mmprojPath: null, port: 1, key: 'k', contextSize: 16384 };
  const value = (args, flag) => args[args.indexOf(flag) + 1];

  it('is asked for only when the file has the head, with three tokens drafted a step and n-gram lookup beside it', () => {
    const on = serverArgs({ ...base, mtp: true });
    assert.equal(value(on, '--spec-type'), 'draft-mtp,ngram-map-k');
    assert.equal(value(on, '--spec-draft-n-max'), '3');
    for (const args of [serverArgs(base), serverArgs({ ...base, mtp: false })]) assert.ok(!args.includes('--spec-type'));
  });

  it('puts the projector on the processor only when there is one and it was asked for', () => {
    assert.ok(!serverArgs({ ...base, cpuProjector: true }).includes('--no-mmproj-offload'), 'no projector, nothing to move');
    const withImages = { ...base, mmprojPath: '/m/mmproj.gguf' };
    assert.ok(!serverArgs(withImages).includes('--no-mmproj-offload'));
    assert.ok(serverArgs({ ...withImages, cpuProjector: true }).includes('--no-mmproj-offload'));
  });
});
