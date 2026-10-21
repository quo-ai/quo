'use strict';

// The faster engine for a graphics card: which build a card gets, where it may come from, and that nothing is used
// unless it matched the lock, unpacked, and saw the card. Tries to abuse each step.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const { Accelerators, chooseBuild, downloadArchive, parseNvidia, releaseUrl } = require('../src/engine/accelerators');
const lock = require('../engine.lock.json');
const { tempDir } = require('./tempdir');

const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const body = data => new Response(data, { status: 200 });
const redirect = location => new Response(null, { status: 302, headers: { location } });

describe('which build a card gets', () => {
  it('reads the cards and the driver from nvidia-smi, in both of its formats', () => {
    assert.deepEqual(parseNvidia('8.6\n7.5\n', 'CUDA Version                : 13.4 [Deprecated]'), { compute: 7.5, cuda: 13.4 });
    assert.deepEqual(parseNvidia('6.1', '| NVIDIA-SMI 550.54  Driver Version: 550.54  CUDA Version: 12.4 |'), { compute: 6.1, cuda: 12.4 });
    assert.equal(parseNvidia('', 'CUDA Version: 13.0'), null);
    assert.equal(parseNvidia('8.6', 'nothing here'), null);
  });

  it('picks CUDA 13 for a Turing card or newer with a 13.x driver, CUDA 12 for older cards or drivers, and nothing below that', () => {
    const linux = lock.accelerators['linux-x64'];
    const win = lock.accelerators['win-x64'];
    assert.equal(chooseBuild(linux, { compute: 8.6, cuda: 13.4 }).id, 'cuda13');
    assert.equal(chooseBuild(linux, { compute: 6.1, cuda: 13.4 }).id, 'cuda12', 'CUDA 13 has no Pascal support');
    assert.equal(chooseBuild(linux, { compute: 8.6, cuda: 12.8 }).id, 'cuda12');
    assert.equal(chooseBuild(linux, { compute: 8.6, cuda: 12.4 }), null, 'the Linux CUDA 12 build needs 12.8');
    assert.equal(chooseBuild(win, { compute: 8.6, cuda: 12.4 }).id, 'cuda12');
    assert.equal(chooseBuild(win, { compute: 3.5, cuda: 13.4 }), null);
    assert.equal(chooseBuild(linux, null), null);
    assert.equal(chooseBuild(undefined, { compute: 9, cuda: 13 }), null);
  });

  it('is pinned in the lock for the bundled release only, with a SHA-256 and size for every archive', () => {
    for (const [target, builds] of Object.entries(lock.accelerators)) {
      if (target.startsWith('_')) continue;
      for (const build of Object.values(builds)) {
        for (const file of build.files) {
          assert.match(file.sha256, /^[0-9a-f]{64}$/, file.file);
          assert.ok(Number.isSafeInteger(file.bytes) && file.bytes > 1e6, file.file);
          assert.ok(file.file.includes(lock.release) || file.file.startsWith('cudart-llama-bin-'), `${file.file} is from ${lock.release}`);
        }
      }
    }
    assert.equal(releaseUrl(lock.release, 'a b.zip'), `https://github.com/ggml-org/llama.cpp/releases/download/${lock.release}/a%20b.zip`);
  });
});

describe('where a build may come from', () => {
  it('starts only at github.com over https, and follows only GitHub’s own download hosts', async () => {
    const dir = tempDir('quo-accel-');
    const target = path.join(dir, 'x');
    for (const start of ['http://github.com/a', 'https://evil.example/a', 'https://github.com.evil.example/a', 'https://objects.githubusercontent.com/a']) {
      await assert.rejects(downloadArchive(start, target, { fetchImpl: async () => body('x') }), error => error.code === 'bad_url', start);
    }
    for (const hop of ['https://evil.example/file', 'http://objects.githubusercontent.com/file', 'https://githubusercontent.com.evil.example/x']) {
      await assert.rejects(downloadArchive('https://github.com/a', target, { fetchImpl: async url => (url.hostname === 'github.com' ? redirect(hop) : body('x')) }), error => error.code === 'bad_url', hop);
    }
    const seen = [];
    const digest = await downloadArchive('https://github.com/a', target, { fetchImpl: async url => (seen.push(url.hostname), url.hostname === 'github.com' ? redirect('https://release-assets.githubusercontent.com/f') : body('engine')) });
    assert.deepEqual(seen, ['github.com', 'release-assets.githubusercontent.com']);
    assert.equal(digest, sha('engine'));
    assert.equal(fs.readFileSync(target, 'utf8'), 'engine');
  });

  it('gives up on a redirect loop and on a failed response', async () => {
    const dir = tempDir('quo-accel-');
    await assert.rejects(downloadArchive('https://github.com/a', path.join(dir, 'x'), { fetchImpl: async () => redirect('https://objects.githubusercontent.com/again') }), error => error.code === 'download_failed');
    await assert.rejects(downloadArchive('https://github.com/a', path.join(dir, 'y'), { fetchImpl: async () => new Response('no', { status: 404 }) }), error => error.code === 'download_failed');
  });
});

describe('installing', () => {
  const archive = 'engine-pack';
  const setup = ({ devices = [{ backend: 'cuda' }], served = archive, fileSha = sha(archive) } = {}) => {
    const root = tempDir('quo-accel-');
    const fakeLock = { release: 'b1', accelerators: { 'linux-x64': { cuda13: { label: 'NVIDIA CUDA 13', minCompute: 7.5, minCuda: 13, files: [{ file: 'pack.tar.gz', bytes: archive.length, sha256: fileSha }] } } } };
    const unpacked = [];
    const accelerators = new Accelerators({
      root,
      choiceFile: path.join(root, 'choice.json'),
      lock: fakeLock,
      target: 'linux-x64',
      binaryName: 'llama-server',
      detect: async () => ({ compute: 8.6, cuda: 13.4 }),
      listDevices: async () => devices,
      fetchImpl: async url => (url.hostname === 'github.com' ? redirect('https://objects.githubusercontent.com/pack') : body(served)),
      // Like the real archives: the engine in one folder, the CUDA runtime in another.
      unpackImpl: async (file, destination) => {
        unpacked.push(path.basename(file));
        fs.mkdirSync(path.join(destination, 'llama-b1'), { recursive: true });
        fs.mkdirSync(path.join(destination, 'cudart-b1'), { recursive: true });
        fs.writeFileSync(path.join(destination, 'llama-b1', 'llama-server'), 'bin');
        fs.writeFileSync(path.join(destination, 'cudart-b1', 'libcudart.so.13'), 'lib');
      },
    });
    return { root, accelerators, unpacked };
  };

  it('downloads, checks, unpacks the runtime beside the engine, and uses it', async () => {
    const { root, accelerators } = setup();
    assert.equal(await accelerators.engineDir(), null);
    const progress = [];
    const status = await accelerators.install({ onProgress: (loaded, total) => progress.push([loaded, total]) });
    assert.equal(status.installed, true);
    assert.deepEqual(progress.at(-1), [archive.length, archive.length]);
    const dir = await accelerators.engineDir();
    assert.ok(dir.startsWith(root));
    assert.ok(fs.existsSync(path.join(dir, 'llama-server')) && fs.existsSync(path.join(dir, 'libcudart.so.13')));
    assert.ok(!fs.existsSync(`${accelerators.dirFor('cuda13')}.partial`), 'no staging left behind');
  });

  it('uses nothing when the download does not match the lock, and leaves nothing behind', async () => {
    const { accelerators, unpacked } = setup({ served: 'tampered' });
    await assert.rejects(accelerators.install(), error => error.code === 'checksum');
    assert.deepEqual(unpacked, [], 'a file that failed the check is never unpacked');
    assert.equal(await accelerators.engineDir(), null);
    assert.ok(!fs.existsSync(accelerators.dirFor('cuda13')) && !fs.existsSync(`${accelerators.dirFor('cuda13')}.partial`));
  });

  it('uses nothing when the build cannot see a CUDA device (it would only run on the processor)', async () => {
    const { accelerators } = setup({ devices: [{ backend: 'vulkan' }] });
    await assert.rejects(accelerators.install(), error => error.code === 'no_device');
    assert.equal(await accelerators.engineDir(), null);
  });

  it('goes back to the bundled engine after a failed start, and again only when the person turns it on', async () => {
    const { accelerators } = setup();
    await accelerators.install();
    await accelerators.markFailed('engine_failed');
    assert.equal(await accelerators.engineDir(), null);
    assert.equal((await accelerators.status()).failed, 'engine_failed');
    await accelerators.use(true);
    assert.ok(await accelerators.engineDir());
    await accelerators.use(false);
    assert.equal(await accelerators.engineDir(), null);
  });

  it('does not trust an install for another release or other files, and removes completely', async () => {
    const { accelerators } = setup();
    await accelerators.install();
    const marker = path.join(accelerators.dirFor('cuda13'), 'quo-accelerator.json');
    const original = fs.readFileSync(marker, 'utf8');
    fs.writeFileSync(marker, JSON.stringify({ ...JSON.parse(original), sha256: ['0'.repeat(64)] }));
    assert.equal(await accelerators.engineDir(), null);
    fs.writeFileSync(marker, JSON.stringify({ ...JSON.parse(original), home: '../../outside' }));
    assert.equal(await accelerators.engineDir(), null, 'the engine folder must be inside the install');
    fs.writeFileSync(marker, original);
    assert.ok(await accelerators.engineDir());
    await accelerators.remove();
    assert.equal(await accelerators.engineDir(), null);
    assert.ok(!fs.existsSync(accelerators.dirFor('cuda13')));
  });

  it('offers nothing where the lock has no build for this computer or the card is unknown', async () => {
    const root = tempDir('quo-accel-');
    for (const options of [{ target: 'mac-arm64', detect: async () => ({ compute: 9, cuda: 13 }) }, { target: 'linux-x64', detect: async () => null }]) {
      const accelerators = new Accelerators({ root, choiceFile: path.join(root, 'c.json'), lock, binaryName: 'llama-server', ...options });
      assert.equal((await accelerators.status()).available, false);
      await assert.rejects(accelerators.install(), error => error.code === 'unavailable');
    }
  });
});
