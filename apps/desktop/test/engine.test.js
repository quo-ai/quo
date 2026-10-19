'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { after, before, describe, it } = require('node:test');
const { LlamaEngine, engineTarget, explainFailure, parseDevices } = require('../src/engine/llama');
const { ModelError, ModelStore, findProjector } = require('../src/engine/models');

const { tempDir } = require('./tempdir');

const temp = () => tempDir('quo-test-');
const gguf = (size, fill = 7) => Buffer.concat([Buffer.from('GGUF'), Buffer.alloc(size - 4, fill)]);
const permissive = () => true;

function makeStore(overrides = {}) {
  const root = temp();
  const events = [];
  const store = new ModelStore({
    directory: path.join(root, 'models'),
    customFile: path.join(root, 'custom-models.json'),
    emit: event => events.push(event),
    ...overrides,
  });
  return { root, store, events };
}

describe('llama-server output', () => {
  it('reads GPUs and their memory', () => {
    const devices = parseDevices(`Available devices:
  Vulkan0: NVIDIA GeForce RTX 3070 Ti (8192 MiB, 6192 MiB free)
  MTL0: Apple M3 Pro (12288 MiB, 12287 MiB free)`);
    assert.deepEqual(devices.map(d => [d.backend, d.name, d.totalMiB, d.freeMiB]), [
      ['vulkan', 'NVIDIA GeForce RTX 3070 Ti', 8192, 6192],
      ['metal', 'Apple M3 Pro', 12288, 12287],
    ]);
  });

  it('finds no devices in unrelated text', () => {
    assert.deepEqual(parseDevices('ggml_vulkan: Found 0 Vulkan devices'), []);
  });

  it('explains common failures in plain words', () => {
    assert.equal(explainFailure(['llama_model_load: unknown model architecture: foo']).code, 'unsupported_model');
    assert.equal(explainFailure(['ggml_vulkan: ErrorOutOfDeviceMemory']).code, 'out_of_memory');
    assert.equal(explainFailure(['error loading model: bad magic']).code, 'load_failed');
    assert.equal(explainFailure(['something else']).code, 'engine_failed');
  });

  it('knows which bundled build belongs to a platform', () => {
    assert.equal(engineTarget('darwin', 'arm64'), 'mac-arm64');
    assert.equal(engineTarget('win32', 'x64'), 'win-x64');
    assert.equal(engineTarget('linux', 'x64'), 'linux-x64');
    assert.equal(engineTarget('freebsd', 'x64'), null);
    assert.equal(engineTarget('linux', 'ia32'), null);
  });

  it('is unavailable (not crashing) when the engine folder is empty', async () => {
    const engine = new LlamaEngine({ directory: temp() });
    assert.equal(engine.available, false);
    assert.deepEqual(await engine.devices(), []);
    await assert.rejects(engine.start({ modelId: 'x', modelPath: 'x', contextSize: 2048 }), { code: 'engine_missing' });
  });

  it('does not kill an unrelated process left in the pid file', async () => {
    const root = temp();
    const pidFile = path.join(root, 'engine.pid');
    fs.writeFileSync(pidFile, String(process.pid)); // this test run, which is not llama-server
    await new LlamaEngine({ directory: root, pidFile }).reapStale();
    assert.equal(fs.existsSync(pidFile), false);
    process.kill(process.pid, 0); // still alive
  });
});

describe('model files', () => {
  it('rejects ids and file names that could escape the models folder', () => {
    const { store } = makeStore();
    for (const id of ['../x', 'a/b', '..', '', '.hidden', 'x'.repeat(80)]) assert.throws(() => store.dirFor(id), { code: 'bad_model_id' });
    for (const name of ['../model.gguf', 'a/b.gguf', '', '.x']) assert.throws(() => store.filePath('ok', name), { code: 'bad_file_name' });
  });

  it('reports what is on disk', async () => {
    const { store } = makeStore();
    const files = [{ name: 'model.gguf', sizeBytes: 1000 }, { name: 'mmproj.gguf', sizeBytes: 500 }];
    assert.deepEqual(await store.state('m', files), { installed: false, downloadedBytes: 0, totalBytes: 1500 });
    fs.mkdirSync(store.dirFor('m'), { recursive: true });
    fs.writeFileSync(store.filePath('m', 'model.gguf.part'), Buffer.alloc(400));
    assert.deepEqual(await store.state('m', files), { installed: false, downloadedBytes: 400, totalBytes: 1500 });
    fs.writeFileSync(store.filePath('m', 'model.gguf'), gguf(1000));
    fs.writeFileSync(store.filePath('m', 'mmproj.gguf'), gguf(500));
    assert.equal((await store.state('m', files)).installed, true);
  });

  it('does not call a right-sized file installed unless it is GGUF', async () => {
    const { store } = makeStore();
    fs.mkdirSync(store.dirFor('m'), { recursive: true });
    fs.writeFileSync(store.filePath('m', 'model.gguf'), Buffer.alloc(1000, 1));
    assert.equal((await store.state('m', [{ name: 'model.gguf', sizeBytes: 1000 }])).installed, false);
  });
});

describe('downloads', () => {
  const body = gguf(3 * 1024 * 1024 + 123);
  let server;
  let base;
  let requests;
  let interruptFirst = false;

  before(async () => {
    server = http.createServer((req, res) => {
      requests.push({ url: req.url, range: req.headers.range });
      if (req.url === '/missing.gguf') return res.writeHead(404).end();
      const data = req.url === '/wrong-type.gguf' ? Buffer.alloc(body.length, 9) : body;
      const match = /bytes=(\d+)-/.exec(req.headers.range ?? '');
      const start = match ? Number(match[1]) : 0;
      res.writeHead(match ? 206 : 200, { 'content-length': data.length - start, 'content-type': 'application/octet-stream' });
      if (interruptFirst && !match) {
        interruptFirst = false;
        res.write(data.subarray(0, 1024 * 1024));
        return setTimeout(() => res.destroy(), 30); // the connection drops part-way
      }
      res.end(data.subarray(start));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server.close());

  const file = (name, url) => ({ url: `${base}/${url}`, name, sizeBytes: body.length });
  const last = events => events.at(-1);

  it('downloads, verifies and installs', async () => {
    requests = [];
    const { store, events } = makeStore({ isAllowedUrl: permissive });
    await store.download('m', [file('model.gguf', 'ok.gguf')]);
    assert.equal(last(events).type, 'done');
    assert.equal(fs.statSync(store.filePath('m', 'model.gguf')).size, body.length);
    assert.equal(fs.existsSync(store.filePath('m', 'model.gguf.part')), false);
    assert.equal(crypto.createHash('sha1').update(fs.readFileSync(store.filePath('m', 'model.gguf'))).digest('hex'), crypto.createHash('sha1').update(body).digest('hex'));
  });

  it('resumes from a partial file with a Range request', async () => {
    requests = [];
    const { store, events } = makeStore({ isAllowedUrl: permissive });
    fs.mkdirSync(store.dirFor('m'), { recursive: true });
    fs.writeFileSync(store.filePath('m', 'model.gguf.part'), body.subarray(0, 1_000_000));
    await store.download('m', [file('model.gguf', 'ok.gguf')]);
    assert.equal(last(events).type, 'done');
    assert.equal(requests[0].range, 'bytes=1000000-');
    assert.ok(fs.readFileSync(store.filePath('m', 'model.gguf')).equals(body));
  });

  it('carries on after the connection drops mid-download', async () => {
    requests = [];
    interruptFirst = true;
    const { store, events } = makeStore({ isAllowedUrl: permissive });
    await store.download('m', [file('model.gguf', 'ok.gguf')]);
    assert.equal(last(events).type, 'done');
    assert.ok(events.some(e => e.type === 'waiting'));
    assert.ok(fs.readFileSync(store.filePath('m', 'model.gguf')).equals(body));
  });

  it('reports a server error without installing anything', async () => {
    const { store, events } = makeStore({ isAllowedUrl: permissive });
    await store.download('m', [file('model.gguf', 'missing.gguf')]);
    assert.equal(last(events).type, 'error');
    assert.equal(last(events).code, 'http_404');
    assert.equal(fs.existsSync(store.filePath('m', 'model.gguf')), false);
  });

  it('refuses a download that is not a model file', async () => {
    const { store, events } = makeStore({ isAllowedUrl: permissive });
    await store.download('m', [file('model.gguf', 'wrong-type.gguf')]);
    assert.equal(last(events).code, 'not_gguf');
    assert.equal(fs.existsSync(store.filePath('m', 'model.gguf')), false);
    assert.equal(fs.existsSync(store.filePath('m', 'model.gguf.part')), false);
  });

  it('can be cancelled, keeping the partial file for later', async () => {
    const { store, events } = makeStore({ isAllowedUrl: permissive });
    const slow = http.createServer((req, res) => {
      res.writeHead(200, { 'content-length': body.length });
      res.write(body.subarray(0, 500_000));
    });
    await new Promise(resolve => slow.listen(0, '127.0.0.1', resolve));
    const run = store.download('m', [{ url: `http://127.0.0.1:${slow.address().port}/x.gguf`, name: 'model.gguf', sizeBytes: body.length }]);
    await new Promise(resolve => setTimeout(resolve, 300));
    store.cancel('m');
    await run;
    slow.closeAllConnections();
    slow.close();
    assert.equal(last(events).code, 'cancelled');
    assert.ok(fs.statSync(store.filePath('m', 'model.gguf.part')).size > 0);
    assert.equal(store.isDownloading('m'), false);
  });

  it('only accepts https addresses on huggingface.co by default', async () => {
    const { store } = makeStore();
    for (const url of ['https://evil.example/model.gguf', 'http://huggingface.co/model.gguf', 'https://huggingface.co.evil.example/m.gguf', 'file:///etc/passwd', 'not a url']) {
      await assert.rejects(store.download('m', [{ url, name: 'model.gguf', sizeBytes: 100 }]), error => error instanceof ModelError && error.code === 'bad_url');
    }
    await assert.rejects(store.download('m', [{ url: 'https://huggingface.co/a/b.gguf', name: 'model.gguf', sizeBytes: -1 }]), { code: 'bad_size' });
  });

  it('removes a model completely', async () => {
    const { store } = makeStore({ isAllowedUrl: permissive });
    await store.download('m', [file('model.gguf', 'ok.gguf')]);
    await store.remove('m');
    assert.equal(fs.existsSync(store.dirFor('m')), false);
  });
});

describe('models you already have', () => {
  it('adds a GGUF file in place, and refuses anything else', async () => {
    const { root, store } = makeStore();
    const good = path.join(root, 'mine.gguf');
    fs.writeFileSync(good, gguf(2048));
    const entry = await store.addCustom(good);
    assert.match(entry.id, /^custom-[0-9a-f]{10}$/);
    assert.equal(entry.name, 'mine');
    assert.equal(entry.path, fs.realpathSync.native(good));
    assert.deepEqual((await store.customModels()).map(m => m.id), [entry.id]);
    assert.equal((await store.addCustom(good)).id, entry.id); // adding twice doesn't duplicate
    assert.equal((await store.customModels()).length, 1);

    const bad = path.join(root, 'notes.gguf');
    fs.writeFileSync(bad, 'just some text');
    await assert.rejects(store.addCustom(bad), { code: 'not_gguf' });
    await assert.rejects(store.addCustom(path.join(root, 'nothing.gguf')), { code: 'not_gguf' });

    await store.removeCustom(entry.id);
    assert.equal((await store.customModels()).length, 0);
    assert.ok(fs.existsSync(good), 'forgetting a model never deletes the file');
  });

  it('pairs a vision projector only when it clearly belongs to the model', async () => {
    const root = temp();
    const make = (directory, ...names) => {
      fs.mkdirSync(directory, { recursive: true });
      for (const name of names) fs.writeFileSync(path.join(directory, name), gguf(64));
      return directory;
    };
    const one = make(path.join(root, 'one'), 'model-Q4.gguf', 'mmproj-F16.gguf');
    assert.equal(await findProjector(path.join(one, 'model-Q4.gguf')), path.join(one, 'mmproj-F16.gguf'));
    const many = make(path.join(root, 'many'), 'a.gguf', 'b.gguf', 'mmproj-F16.gguf');
    assert.equal(await findProjector(path.join(many, 'a.gguf')), null);
    const none = make(path.join(root, 'none'), 'a.gguf');
    assert.equal(await findProjector(path.join(none, 'a.gguf')), null);
    const twice = make(path.join(root, 'twice'), 'a.gguf', 'mmproj-1.gguf', 'mmproj-2.gguf');
    assert.equal(await findProjector(path.join(twice, 'a.gguf')), null);
  });

  describe('finding them in other apps', () => {
    const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, OLLAMA_MODELS: process.env.OLLAMA_MODELS };
    after(() => {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });

    it('does not offer a model again once added, even when its folder is reached through a symlink', { skip: process.platform === 'win32' }, async () => {
      // macOS reaches /tmp and /var through symlinks, and so can any home folder or models drive.
      const real = temp();
      const home = path.join(temp(), 'home-link');
      fs.symlinkSync(real, home);
      process.env.HOME = home;
      process.env.USERPROFILE = home;
      delete process.env.OLLAMA_MODELS;
      const lm = path.join(home, '.lmstudio', 'models', 'someone', 'model-GGUF');
      fs.mkdirSync(lm, { recursive: true });
      const file = path.join(lm, 'model-Q4_K_M.gguf');
      fs.writeFileSync(file, gguf(64));
      fs.truncateSync(file, 60 * 1024 * 1024);

      const { store } = makeStore();
      const [found] = await store.scanExternal();
      assert.equal(found.name, 'model-Q4_K_M');
      await store.addCustom(found.path);
      assert.deepEqual(await store.scanExternal(), []);
    });

    it('lists Ollama and LM Studio models, with projectors, and skips ones already added', async () => {
      const home = temp();
      process.env.HOME = home;
      process.env.USERPROFILE = home;
      process.env.OLLAMA_MODELS = path.join(home, 'ollama-models');

      const blobs = path.join(process.env.OLLAMA_MODELS, 'blobs');
      fs.mkdirSync(blobs, { recursive: true });
      const digest = type => crypto.createHash('sha256').update(type).digest('hex');
      fs.writeFileSync(path.join(blobs, `sha256-${digest('model')}`), gguf(4096));
      fs.writeFileSync(path.join(blobs, `sha256-${digest('projector')}`), gguf(2048));
      const manifests = path.join(process.env.OLLAMA_MODELS, 'manifests', 'registry.ollama.ai', 'library', 'gemma3');
      fs.mkdirSync(manifests, { recursive: true });
      fs.writeFileSync(path.join(manifests, '4b'), JSON.stringify({
        layers: [
          { mediaType: 'application/vnd.ollama.image.model', digest: `sha256:${digest('model')}` },
          { mediaType: 'application/vnd.ollama.image.projector', digest: `sha256:${digest('projector')}` },
          { mediaType: 'application/vnd.ollama.image.model', digest: '../../../etc/passwd' },
        ].slice(0, 2),
      }));
      // A manifest that points outside the blobs folder is ignored, not followed.
      const evil = path.join(process.env.OLLAMA_MODELS, 'manifests', 'registry.ollama.ai', 'library', 'evil');
      fs.mkdirSync(evil, { recursive: true });
      fs.writeFileSync(path.join(evil, 'latest'), JSON.stringify({ layers: [{ mediaType: 'application/vnd.ollama.image.model', digest: 'sha256:../../../../etc/passwd' }] }));

      const lm = path.join(home, '.lmstudio', 'models', 'someone', 'cool-model-GGUF');
      fs.mkdirSync(lm, { recursive: true });
      const big = path.join(lm, 'cool-model-Q4_K_M.gguf');
      fs.writeFileSync(big, gguf(64));
      fs.truncateSync(big, 60 * 1024 * 1024); // sparse: counts as a real-sized model
      fs.writeFileSync(path.join(lm, 'mmproj-F16.gguf'), gguf(64));
      const tiny = path.join(lm, 'tiny-test.gguf'); // too small to be a real model: left out
      fs.writeFileSync(tiny, gguf(64));

      const { store } = makeStore();
      const found = await store.scanExternal();
      const byName = Object.fromEntries(found.map(entry => [entry.name, entry]));
      assert.deepEqual(Object.keys(byName).sort(), ['cool-model-Q4_K_M', 'gemma3:4b']);
      assert.equal(byName['gemma3:4b'].source, 'ollama');
      assert.ok(byName['gemma3:4b'].mmprojPath.endsWith(digest('projector').replace(/^/, 'sha256-')));
      assert.equal(byName['cool-model-Q4_K_M'].source, 'lmstudio');
      assert.equal(byName['cool-model-Q4_K_M'].mmprojPath, undefined, 'two models in the folder (one tiny) means no projector is guessed');

      await store.addCustom(byName['gemma3:4b'].path, { name: byName['gemma3:4b'].name, mmprojPath: byName['gemma3:4b'].mmprojPath });
      assert.deepEqual((await store.scanExternal()).map(e => e.name), ['cool-model-Q4_K_M']);
    });
  });
});

describe('a model file from an earlier edition', () => {
  const edition = (altSizes = undefined) => [{ name: 'model.gguf', sizeBytes: 2000, ...(altSizes ? { altSizes } : {}) }];

  it('counts as downloaded at a size the catalog used to have, so nobody downloads it again', async () => {
    const { store } = makeStore();
    fs.mkdirSync(path.join(store.directory, 'm'), { recursive: true });
    fs.writeFileSync(path.join(store.directory, 'm', 'model.gguf'), gguf(1500));
    assert.equal((await store.state('m', edition([1500]))).installed, true);
    assert.deepEqual(await store.state('m', edition([1500])), { installed: true, downloadedBytes: 2000, totalBytes: 2000 });
  });

  it('does not count a size nobody ever shipped, a cut-off file, or a file without the model signature', async () => {
    const { store } = makeStore();
    fs.mkdirSync(path.join(store.directory, 'm'), { recursive: true });
    fs.writeFileSync(path.join(store.directory, 'm', 'model.gguf'), gguf(1234));
    assert.equal((await store.state('m', edition([1500]))).installed, false);
    assert.equal((await store.state('m', edition())).installed, false);
    fs.writeFileSync(path.join(store.directory, 'm', 'model.gguf'), Buffer.alloc(1500, 7));
    assert.equal((await store.state('m', edition([1500]))).installed, false, 'the signature is still checked');
    fs.rmSync(path.join(store.directory, 'm', 'model.gguf'));
    for (const bad of [[0], [-1], [Number.NaN], ['1500']]) assert.equal((await store.state('m', edition(bad))).installed, false, `a missing file is not whole at ${bad}`);
  });

  it('still counts the current size, and ignores a malformed list of old sizes', async () => {
    const { store } = makeStore();
    fs.mkdirSync(path.join(store.directory, 'm'), { recursive: true });
    fs.writeFileSync(path.join(store.directory, 'm', 'model.gguf'), gguf(2000));
    assert.equal((await store.state('m', edition([1500]))).installed, true);
    assert.equal((await store.state('m', [{ name: 'model.gguf', sizeBytes: 2000, altSizes: 'nope' }])).installed, true);
    fs.writeFileSync(path.join(store.directory, 'm', 'model.gguf'), gguf(1500));
    assert.equal((await store.state('m', [{ name: 'model.gguf', sizeBytes: 2000, altSizes: 'nope' }])).installed, false);
  });
});
