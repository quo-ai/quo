'use strict';

const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

/**
 * Optional faster engines for a graphics card (vLLM's "most hardware"): llama.cpp's own CUDA builds for NVIDIA cards.
 * The app ships the Vulkan build, which runs on almost any card; on an RTX 3070 Ti the CUDA build read prompts 40%
 * faster (3,578 -> 4,998 tok/s) and wrote 11% faster (120 -> 134), but it is 550-770 MB, too much to bundle for everyone.
 *
 * So it is downloaded only when the person asks, and only what engine.lock.json names: the same llama.cpp release as the
 * bundled engine, from its GitHub release, every archive checked against the SHA-256 in the lock before it is unpacked.
 * The page never supplies a name, an address or a path: main chooses the build from the card (nvidia-smi) and the lock.
 * A build is installed only once it has listed a CUDA device; if it later fails to start, the bundled engine is used.
 */

const RELEASE_HOST = 'github.com';
/** Where GitHub sends a release download. Anything else is refused. */
const REDIRECT_HOSTS = new Set(['objects.githubusercontent.com', 'release-assets.githubusercontent.com']);
const MARKER = 'quo-accelerator.json';

class AcceleratorError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const run = (command, args, options = {}) => new Promise(resolve => {
  execFile(command, args, { timeout: 30_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024, ...options }, (error, stdout, stderr) => resolve({ error, out: `${stdout ?? ''}\n${stderr ?? ''}` }));
});

/** What nvidia-smi says about the cards: the lowest compute capability and the CUDA version the driver supports. */
function parseNvidia(query, details) {
  const computes = query.split(/\r?\n/).map(line => Number.parseFloat(line.split(',')[0])).filter(Number.isFinite);
  const cuda = /CUDA (?:UMD )?Version\s*:\s*([\d.]+)/i.exec(details) ?? /CUDA Version:\s*([\d.]+)/i.exec(details);
  if (!computes.length || !cuda) return null;
  return { compute: Math.min(...computes), cuda: Number.parseFloat(cuda[1]) };
}

async function detectNvidia(exec = run) {
  const query = await exec('nvidia-smi', ['--query-gpu=compute_cap', '--format=csv,noheader']);
  if (query.error) return null;
  const details = await exec('nvidia-smi', ['-q']);
  return parseNvidia(query.out, details.error ? '' : details.out);
}

/** The build for this card, from the lock: the newest it can run (CUDA 13 needs a Turing card or newer and a 13.x driver). */
function chooseBuild(builds, card) {
  if (!builds || !card) return null;
  for (const [id, build] of Object.entries(builds)) {
    if (id.startsWith('_')) continue;
    if (card.compute >= build.minCompute && card.cuda >= build.minCuda) return { id, ...build };
  }
  return null;
}

const releaseUrl = (release, file) => `https://${RELEASE_HOST}/ggml-org/llama.cpp/releases/download/${release}/${encodeURIComponent(file)}`;

/** Downloads one archive, following only GitHub's own redirects, hashing as it goes. Resolves to the SHA-256. */
async function downloadArchive(url, target, { signal, onBytes, fetchImpl = fetch }) {
  let address = new URL(url);
  let response;
  for (let hop = 0; ; hop++) {
    if (hop > 5) throw new AcceleratorError('download_failed', 'Too many redirects.');
    const allowed = hop === 0 ? address.hostname === RELEASE_HOST : REDIRECT_HOSTS.has(address.hostname);
    if (address.protocol !== 'https:' || !allowed) throw new AcceleratorError('bad_url', 'Refused a download from an unexpected address.');
    response = await fetchImpl(address, { redirect: 'manual', signal });
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      address = new URL(response.headers.get('location'), address);
      continue;
    }
    break;
  }
  if (!response.ok || !response.body) throw new AcceleratorError('download_failed', `The download failed (${response.status}).`);
  const hash = crypto.createHash('sha256');
  const out = fs.createWriteStream(target);
  try {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      onBytes?.(value.length);
      if (!out.write(value)) await new Promise(resolve => out.once('drain', resolve));
    }
  } finally {
    await new Promise(resolve => out.end(resolve));
  }
  return hash.digest('hex');
}

/** Unpacks with the system's own tar (Windows 10 and later ship one that reads zip files too). */
async function unpack(archive, destination, platform = process.platform) {
  const tar = platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  const args = platform === 'win32' ? ['-xf', archive, '-C', destination] : ['-xzf', archive, '-C', destination];
  const { error } = await run(tar, args, { timeout: 10 * 60_000 });
  if (error) throw new AcceleratorError('unpack_failed', 'The download couldn’t be unpacked.');
}

/** Every file under `dir` moved into one folder beside llama-server (the archives put the runtime in its own folder). */
async function flatten(dir, binaryName) {
  const files = [];
  const walk = async (current, depth) => {
    for (const entry of await fsp.readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory() && depth < 3) await walk(full, depth + 1);
      else if (entry.isFile() || entry.isSymbolicLink()) files.push(full);
    }
  };
  await walk(dir, 0);
  const server = files.find(file => path.basename(file) === binaryName);
  if (!server) throw new AcceleratorError('unpack_failed', 'The download had no engine in it.');
  const home = path.dirname(server);
  for (const file of files) {
    const target = path.join(home, path.basename(file));
    if (path.dirname(file) !== home && !fs.existsSync(target)) await fsp.rename(file, target);
  }
  return home;
}

class Accelerators {
  /**
   * @param {{ root: string, choiceFile: string, lock: object, target: string|null, binaryName: string,
   *   detect?: () => Promise<{compute:number,cuda:number}|null>, listDevices?: (dir: string) => Promise<{backend:string}[]>,
   *   fetchImpl?: typeof fetch, unpackImpl?: typeof unpack }} options
   */
  constructor({ root, choiceFile, lock, target, binaryName, detect = detectNvidia, listDevices, fetchImpl = fetch, unpackImpl = unpack }) {
    this.root = root;
    this.choiceFile = choiceFile;
    this.release = lock.release;
    this.builds = target ? lock.accelerators?.[target] ?? null : null;
    this.binaryName = binaryName;
    this.detect = detect;
    this.listDevices = listDevices;
    this.fetchImpl = fetchImpl;
    this.unpackImpl = unpackImpl;
    this.card = undefined;
    this.active = null; // AbortController of an install
  }

  async build() {
    if (!this.builds) return null;
    if (this.card === undefined) this.card = await this.detect().catch(() => null);
    return chooseBuild(this.builds, this.card);
  }

  dirFor(id) {
    return path.join(this.root, `${this.release}-${id}`);
  }

  async readChoice() {
    try {
      const choice = JSON.parse(await fsp.readFile(this.choiceFile, 'utf8'));
      return { use: choice.use !== false, failed: typeof choice.failed === 'string' ? choice.failed : null };
    } catch {
      return { use: true, failed: null };
    }
  }

  async writeChoice(choice) {
    await fsp.mkdir(path.dirname(this.choiceFile), { recursive: true });
    await fsp.writeFile(this.choiceFile, JSON.stringify(choice));
  }

  /** The installed build's folder, if its marker matches this release and the lock's files. */
  async installedDir(build) {
    if (!build) return null;
    const dir = this.dirFor(build.id);
    try {
      const marker = JSON.parse(await fsp.readFile(path.join(dir, MARKER), 'utf8'));
      const home = path.join(dir, marker.home ?? '');
      const same = marker.release === this.release && marker.id === build.id && JSON.stringify(marker.sha256) === JSON.stringify(build.files.map(f => f.sha256));
      return same && home.startsWith(dir) && fs.existsSync(path.join(home, this.binaryName)) ? home : null;
    } catch {
      return null;
    }
  }

  /** The folder to run llama-server from instead of the bundled one, or null. */
  async engineDir() {
    const build = await this.build();
    const choice = await this.readChoice();
    if (!choice.use || choice.failed) return null;
    return this.installedDir(build);
  }

  async status() {
    const build = await this.build();
    const choice = await this.readChoice();
    const installed = Boolean(await this.installedDir(build));
    return {
      available: Boolean(build),
      id: build?.id ?? null,
      label: build?.label ?? null,
      bytes: build ? build.files.reduce((sum, f) => sum + f.bytes, 0) : 0,
      installed,
      installing: Boolean(this.active),
      use: choice.use,
      failed: choice.failed,
    };
  }

  cancel() {
    this.active?.abort();
  }

  /** Downloads, checks, unpacks and tries the build for this card. `onProgress(loaded, total)`. */
  async install({ onProgress } = {}) {
    const build = await this.build();
    if (!build) throw new AcceleratorError('unavailable', 'There is no faster engine for this computer.');
    if (this.active) throw new AcceleratorError('busy', 'Already downloading.');
    const controller = new AbortController();
    this.active = controller;
    const dir = this.dirFor(build.id);
    const staging = `${dir}.partial`;
    const total = build.files.reduce((sum, f) => sum + f.bytes, 0);
    let loaded = 0;
    try {
      await fsp.rm(staging, { recursive: true, force: true });
      await fsp.mkdir(path.join(staging, 'archives'), { recursive: true });
      await fsp.mkdir(path.join(staging, 'engine'), { recursive: true });
      for (const file of build.files) {
        const archive = path.join(staging, 'archives', path.basename(file.file));
        const digest = await downloadArchive(releaseUrl(this.release, file.file), archive, {
          signal: controller.signal,
          fetchImpl: this.fetchImpl,
          onBytes: bytes => onProgress?.((loaded += bytes), total),
        });
        if (digest !== file.sha256) throw new AcceleratorError('checksum', 'The download didn’t match the expected file, so it wasn’t used.');
      }
      for (const file of build.files) await this.unpackImpl(path.join(staging, 'archives', path.basename(file.file)), path.join(staging, 'engine'));
      await fsp.rm(path.join(staging, 'archives'), { recursive: true, force: true });
      const home = await flatten(path.join(staging, 'engine'), this.binaryName);
      // Installed only once it can see the card: a build that loads no CUDA device would just run on the processor.
      const devices = this.listDevices ? await this.listDevices(home) : [];
      if (!devices.some(device => device.backend === 'cuda')) throw new AcceleratorError('no_device', 'The faster engine couldn’t use your graphics card, so Quo keeps the one it came with.');
      await fsp.writeFile(path.join(staging, MARKER), JSON.stringify({ release: this.release, id: build.id, sha256: build.files.map(f => f.sha256), home: path.relative(staging, home) }));
      await fsp.rm(dir, { recursive: true, force: true });
      await fsp.rename(staging, dir);
      await this.writeChoice({ use: true });
      return this.status();
    } catch (error) {
      await fsp.rm(staging, { recursive: true, force: true }).catch(() => {});
      if (controller.signal.aborted) throw new AcceleratorError('cancelled', 'Download cancelled.');
      throw error instanceof AcceleratorError ? error : new AcceleratorError('download_failed', 'The download failed. Check your connection and try again.');
    } finally {
      this.active = null;
    }
  }

  async remove() {
    this.cancel();
    const build = await this.build();
    if (build) await fsp.rm(this.dirFor(build.id), { recursive: true, force: true });
    await this.writeChoice({ use: true });
  }

  /** Turns the faster engine on or off; turning it on again clears an earlier failure. */
  async use(on) {
    await this.writeChoice({ use: Boolean(on) });
  }

  async markFailed(code) {
    const choice = await this.readChoice();
    await this.writeChoice({ ...choice, failed: String(code || 'failed') });
  }
}

module.exports = { Accelerators, AcceleratorError, chooseBuild, parseNvidia, downloadArchive, flatten, releaseUrl };
