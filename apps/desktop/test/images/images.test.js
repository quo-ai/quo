'use strict';

// Images made on this computer (src/images/): what the page may ask for, which files may be used, and how sd-cli is
// started. Tries to abuse each part: options smuggled in a prompt, other shapes and numbers, paths for a model id, files
// that aren't whole or aren't Quo's, other pages, and a card out of memory.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const { ImageEngine, ImageError, SHAPES, QUICK, cleanPrompt, imageArgs, isOutOfMemory, parseProgress } = require('../../src/images/engine');
const { checkRequest, imageBytes, modelFolder, setupImages } = require('../../src/images/ipc');
const { ModelStore, ModelError, hasSafetensorsHeader } = require('../../src/engine/models');
const { tempDir } = require('../tempdir');

const fake = path.join(__dirname, 'fake-sd.js');
const GGUF = Buffer.concat([Buffer.from('GGUF'), Buffer.alloc(32)]);
const safetensors = () => {
  const header = Buffer.from('{"__metadata__":{}}');
  const length = Buffer.alloc(8);
  length.writeBigUInt64LE(BigInt(header.length));
  return Buffer.concat([length, header, Buffer.alloc(16)]);
};
const installed = dir => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'diffusion.gguf'), GGUF);
  fs.writeFileSync(path.join(dir, 'text.gguf'), GGUF);
  fs.writeFileSync(path.join(dir, 'vae.safetensors'), safetensors());
};
const page = { senderFrame: { url: 'app://quo/index.html' }, sender: { send() {}, isDestroyed: () => false } };

describe('what the page may ask for', () => {
  it('takes a prompt as text only: no control characters, no leading "-" that sd-cli would read as an option', () => {
    assert.equal(cleanPrompt('a cat\u0000\u001b[31m on a mat'), 'a cat  [31m on a mat');
    assert.equal(cleanPrompt('--vae /etc/passwd a cat'), 'vae /etc/passwd a cat');
    assert.equal(cleanPrompt('  - - -o x'), 'o x');
    assert.equal(cleanPrompt('x'.repeat(5000)).length, 4000);
    for (const value of [undefined, null, 42, {}, ['a']]) assert.equal(cleanPrompt(value), '');
  });

  it('takes only the shapes Quo offers, and keeps steps, guidance and seed within bounds', () => {
    const ok = checkRequest({ modelId: 'z-image-turbo', prompt: 'a lighthouse', aspect: '16:9', steps: 8, cfg: 1, seed: 7 });
    assert.deepEqual(ok, { modelId: 'z-image-turbo', prompt: 'a lighthouse', shape: '16:9', steps: 8, cfg: 1, seed: 7, quick: false, reference: null });
    for (const aspect of ['2:1', '__proto__', 'constructor', '1024x1024', '', undefined]) {
      assert.throws(() => checkRequest({ modelId: 'm', prompt: 'x', aspect }), error => error instanceof ImageError && error.code === 'bad_shape', String(aspect));
    }
    assert.throws(() => checkRequest({ modelId: 'm', prompt: '\u0000 ', aspect: '1:1' }), { code: 'bad_prompt' });
    assert.throws(() => checkRequest({ modelId: ['m'], prompt: 'x', aspect: '1:1' }), { code: 'not_installed' });
    const odd = checkRequest({ modelId: 'm', prompt: 'x', aspect: '1:1', steps: 10_000, cfg: -5, seed: -1, extra: '--vae /x' });
    assert.equal(odd.steps, 8);
    assert.equal(odd.cfg, 1);
    assert.ok(Number.isSafeInteger(odd.seed) && odd.seed >= 0);
    assert.equal('extra' in odd, false);
  });

  it('builds sd-cli’s arguments from Quo’s own files and checked numbers, the prompt as one argument', () => {
    const args = imageArgs({ dir: '/models/z', prompt: 'a cat; rm -rf / && echo', shape: '3:2', steps: 8, cfg: 1, seed: 3, output: '/tmp/out.png' });
    assert.deepEqual(args.slice(0, 6), ['--diffusion-model', path.join('/models/z', 'diffusion.gguf'), '--llm', path.join('/models/z', 'text.gguf'), '--vae', path.join('/models/z', 'vae.safetensors')]);
    assert.equal(args[args.indexOf('-p') + 1], 'a cat; rm -rf / && echo');
    assert.deepEqual([args[args.indexOf('-W') + 1], args[args.indexOf('-H') + 1]], SHAPES['3:2'].map(String));
    for (const [width, height] of Object.values(SHAPES)) assert.ok(width % 64 === 0 && height % 64 === 0 && width * height <= 1_100_000);
  });

  it('knows a full graphics card in each way sd-cli says it', () => {
    // As sd-cli said it on an 8 GB card with a chat model loaded (its model manager), and as Vulkan and CUDA say it.
    assert.equal(isOutOfMemory('[W] model manager cannot make enough memory available on Vulkan0: need 2131.86 MB device / 1619.86 MB budget'), true);
    assert.equal(isOutOfMemory('ggml_vulkan: Device memory allocation of size 2147483648 failed.\nErrorOutOfDeviceMemory'), true);
    assert.equal(isOutOfMemory('CUDA error: out of memory'), true);
    assert.equal(isOutOfMemory('[E] generate failed --- main.cpp:926'), false);
  });

  it('takes a picture to change only as PNG, JPEG or WebP whose bytes say so, and not too big', () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
    assert.equal(imageBytes(`data:image/png;base64,${png.toString('base64')}`).extension, 'png');
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(8)]);
    assert.equal(imageBytes(`data:image/webp;base64,${webp.toString('base64')}`).extension, 'webp');
    for (const value of [
      `data:image/png;base64,${Buffer.from('#!/bin/sh\nrm -rf ~').toString('base64')}`, // says PNG, isn't
      `data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`,
      `data:text/html;base64,${png.toString('base64')}`,
      `https://example.com/a.png`, 'file:///etc/passwd', '/tmp/x.png', 42, {},
      `data:image/png;base64,${'A'.repeat(17_000_000)}`,
      `data:image/webp;base64,${Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE')]).toString('base64')}`,
    ]) assert.throws(() => imageBytes(value), { code: 'bad_reference' }, String(value).slice(0, 40));
    assert.equal(checkRequest({ modelId: 'm', prompt: 'x', aspect: '1:1' }).reference, null);
    assert.throws(() => checkRequest({ modelId: 'm', prompt: 'x', aspect: '1:1', reference: 'nope' }), { code: 'bad_reference' });
  });

  it('makes the quicker size at about half the pixels, and passes a picture to change as one -r file', () => {
    for (const [width, height] of Object.values(QUICK)) assert.ok(width % 64 === 0 && height % 64 === 0 && width * height <= 620_000);
    const args = imageArgs({ dir: '/m', prompt: 'x', shape: '1:1', steps: 4, cfg: 1, seed: 1, output: '/o.png', quick: true, reference: '/tmp/quo-reference-1.png' });
    assert.deepEqual([args[args.indexOf('-W') + 1], args[args.indexOf('-r') + 1]], ['768', '/tmp/quo-reference-1.png']);
    assert.equal(imageArgs({ dir: '/m', prompt: 'x', shape: '1:1', steps: 4, cfg: 1, seed: 1, output: '/o.png' }).includes('-r'), false);
    assert.equal(checkRequest({ modelId: 'm', prompt: 'x', aspect: '1:1', size: 'quick' }).quick, true);
    assert.equal(checkRequest({ modelId: 'm', prompt: 'x', aspect: '1:1', size: '--steps 999' }).quick, false);
  });

  it('reads the progress bar', () => {
    assert.deepEqual(parseProgress('  |===>   | 2/8 -  1.50s/it\r  |=====> | 3/8 -  1.52s/it'), { step: 3, steps: 8 });
    assert.equal(parseProgress('loading tensors'), null);
    // Loading bars count tensors and bytes, not steps.
    assert.equal(parseProgress('  |####   |  11/138 -   0.00MB/s\r  |######| 138/138 - 940.30MB/s'), null);
    assert.deepEqual(parseProgress('| 8/8 -   1.52s/it\r  |#####| 364/452 -  13.23GB/s'), { step: 8, steps: 8 });
  });
});

describe('which model files may be used', () => {
  it('accepts a model only when every file is there, whole and of its kind, under a plain id', async () => {
    const root = tempDir('quo-images-');
    const store = new ModelStore({ directory: root, customFile: path.join(root, 'custom.json'), emit() {} });
    await assert.rejects(modelFolder(store, '../outside'), error => error instanceof ModelError && error.code === 'bad_model_id');
    await assert.rejects(modelFolder(store, 'z-image-turbo'), { code: 'not_installed' });
    installed(path.join(root, 'z-image-turbo'));
    assert.equal(await modelFolder(store, 'z-image-turbo'), path.join(root, 'z-image-turbo'));
    fs.writeFileSync(path.join(root, 'z-image-turbo', 'vae.safetensors'), 'not a safetensors file at all');
    await assert.rejects(modelFolder(store, 'z-image-turbo'), { code: 'not_installed' });
  });

  it('checks a safetensors file’s header, and downloads only .gguf and .safetensors files', async () => {
    const dir = tempDir('quo-st-');
    const good = path.join(dir, 'a.safetensors');
    fs.writeFileSync(good, safetensors());
    assert.equal(await hasSafetensorsHeader(good), true);
    const huge = Buffer.alloc(16);
    huge.writeBigUInt64LE(10n ** 12n);
    huge[8] = 0x7b;
    for (const [name, bytes] of [['b', huge], ['c', Buffer.from('GGUF0000000000')], ['d', Buffer.alloc(4)]]) {
      fs.writeFileSync(path.join(dir, name), bytes);
      assert.equal(await hasSafetensorsHeader(path.join(dir, name)), false, name);
    }
    const store = new ModelStore({ directory: dir, customFile: path.join(dir, 'c.json'), emit() {} });
    for (const name of ['run.sh', 'model.exe', 'vae.bin', 'model.gguf.js']) {
      await assert.rejects(store.download('m', [{ name, url: 'https://huggingface.co/a/b/resolve/main/x', sizeBytes: 10 }]), { code: 'bad_file_name' }, name);
    }
  });
});

describe('making an image', () => {
  const engineFor = dir => new ImageEngine({ directory: null, tmpdir: dir, command: { file: process.execPath, args: [fake] } });

  it('runs sd-cli once, reports its steps, returns the PNG and leaves no file behind', async () => {
    const dir = tempDir('quo-make-');
    const engine = engineFor(dir);
    const steps = [];
    const png = await engine.make({ dir: '/models/z', prompt: 'a cat', shape: '1:1', steps: 3, cfg: 1, seed: 1 }, update => steps.push(update));
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.deepEqual(steps.at(-1), { step: 3, steps: 3 });
    assert.deepEqual(fs.readdirSync(dir).filter(name => name.endsWith('.png')), []);
  });

  it('makes one image at a time, can be stopped, and says when the graphics card ran out of memory', async () => {
    const engine = engineFor(tempDir('quo-make2-'));
    const waiting = engine.make({ dir: '/m', prompt: 'WAIT', shape: '1:1', steps: 3, cfg: 1, seed: 1 });
    await assert.rejects(engine.make({ dir: '/m', prompt: 'a cat', shape: '1:1', steps: 3, cfg: 1, seed: 1 }), { code: 'busy' });
    engine.cancel();
    await assert.rejects(waiting, { code: 'stopped' });
    await assert.rejects(engine.make({ dir: '/m', prompt: 'NO MEMORY', shape: '1:1', steps: 3, cfg: 1, seed: 1 }), { code: 'out_of_memory' });
  });
});

describe('the page’s side', () => {
  const setup = ({ make, stopChat } = {}) => {
    const root = tempDir('quo-ipc-');
    installed(path.join(root, 'z'));
    const handlers = new Map();
    const store = new ModelStore({ directory: root, customFile: path.join(root, 'c.json'), emit() {} });
    const engine = { available: true, make, cancel() {} };
    setupImages({ store, engineDirectory: null, stopChat, ipc: { handle: (channel, fn) => handlers.set(channel, fn) }, engine });
    return handlers;
  };

  it('answers only the app’s own pages, with the image as a PNG data address', async () => {
    const handlers = setup({ make: async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]) });
    for (const url of ['https://huggingface.co/', 'app://other/', 'file:///x']) {
      assert.equal((await handlers.get('images:make')({ senderFrame: { url }, sender: page.sender }, { modelId: 'z', prompt: 'x', aspect: '1:1' })).error.code, 'untrusted');
    }
    const made = await handlers.get('images:make')(page, { modelId: 'z', prompt: 'a cat', aspect: '1:1', seed: 5 });
    assert.deepEqual(made.ok, { image: 'data:image/png;base64,iVBORw==', seed: 5, setAside: false });
  });

  it('sets the chat model aside and tries once more when the card is out of memory; once only', async () => {
    let calls = 0;
    let stopped = 0;
    const handlers = setup({ make: async () => (++calls === 1 ? Promise.reject(new ImageError('out_of_memory')) : Buffer.from('png')), stopChat: async () => stopped++ });
    assert.equal((await handlers.get('images:make')(page, { modelId: 'z', prompt: 'a cat', aspect: '1:1' })).ok.setAside, true);
    assert.deepEqual([calls, stopped], [2, 1]);
    const always = setup({ make: async () => Promise.reject(new ImageError('out_of_memory', 'Not enough graphics memory for this image.')), stopChat: async () => {} });
    assert.equal((await always.get('images:make')(page, { modelId: 'z', prompt: 'a cat', aspect: '1:1' })).error.code, 'out_of_memory');
  });

  it('writes a picture to change to its own file for sd-cli, and removes it afterwards, made or not', async () => {
    let seen = null;
    const handlers = setup({ make: async job => { seen = job.reference; assert.ok(fs.existsSync(job.reference)); throw new ImageError('failed', 'no'); } });
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
    const answer = await handlers.get('images:make')(page, { modelId: 'z', prompt: 'a cat', aspect: '1:1', reference: `data:image/png;base64,${png.toString('base64')}` });
    assert.equal(answer.error.code, 'failed');
    assert.ok(seen && !fs.existsSync(seen));
  });

  it('offers nothing where the image engine isn’t bundled', () => {
    assert.deepEqual(setupImages({ store: null, engineDirectory: null, ipc: { handle() { throw new Error('no handler expected'); } } }), { available: false });
  });
});
