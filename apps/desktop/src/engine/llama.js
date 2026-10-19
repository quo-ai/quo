'use strict';

const { EventEmitter } = require('node:events');
const { execFile, spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

/**
 * Runs llama.cpp's `llama-server` (the pinned release in engine.lock.json) as
 * a child process, one model at a time. It listens only on 127.0.0.1 with a
 * random port and API key that never leave the main process; the renderer
 * reaches it through the app:// protocol handler (protocol.js).
 *
 * A separate process means a crash while loading or running a model can't take
 * the app down, and unloading a model frees its memory by exiting.
 */

const BACKEND_NAMES = { mtl: 'metal', metal: 'metal', vulkan: 'vulkan', cuda: 'cuda', hip: 'rocm', rocm: 'rocm', sycl: 'sycl' };
const HEALTH_TIMEOUT_MS = 5 * 60_000;
const KEEP_LOG_LINES = 80;

/** Where the bundled llama.cpp build for this platform lives, or null. */
function engineTarget(platform = process.platform, arch = process.arch) {
  const os = { darwin: 'mac', win32: 'win', linux: 'linux' }[platform];
  return os && ['x64', 'arm64'].includes(arch) ? `${os}-${arch}` : null;
}

function binaryIn(directory, platform = process.platform) {
  return path.join(directory, platform === 'win32' ? 'llama-server.exe' : 'llama-server');
}

const { hasMtp } = require('./gguf');
const { IdleWatch } = require('./idle');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** `Vulkan0: NVIDIA GeForce RTX 3070 Ti (8192 MiB, 6192 MiB free)` → a device record. */
function parseDevices(text) {
  const devices = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z]+)(\d+):\s*(.+?)\s*\((\d+) MiB,\s*(\d+) MiB free\)/.exec(line);
    if (!match) continue;
    const [, kind, index, name, totalMiB, freeMiB] = match;
    const backend = { Vulkan: 'vulkan', MTL: 'metal', CUDA: 'cuda', ROCm: 'rocm', HIP: 'rocm', SYCL: 'sycl' }[kind] ?? kind.toLowerCase();
    devices.push({ id: `${kind}${index}`, backend, name, totalMiB: Number(totalMiB), freeMiB: Number(freeMiB) });
  }
  return devices;
}

/** A short, plain reason for a failed start, from the server's log. */
function explainFailure(lines) {
  const log = lines.join('\n');
  if (/unknown model architecture|unsupported model|invalid model architecture/i.test(log)) {
    return { code: 'unsupported_model', message: 'This model needs a newer version of Quo.' };
  }
  if (/out of memory|failed to allocate|cudaMalloc failed|ErrorOutOfDeviceMemory|ErrorOutOfHostMemory/i.test(log)) {
    return { code: 'out_of_memory', message: 'This model is too big for your computer’s memory. Try a smaller one.' };
  }
  if (/failed to load model|error loading model|gguf_init_from_file/i.test(log)) {
    return { code: 'load_failed', message: 'The model file couldn’t be loaded. It may be damaged; try downloading it again.' };
  }
  return { code: 'engine_failed', message: 'The AI engine stopped unexpectedly. Try again, or pick another model.' };
}

class EngineError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

/**
 * What llama-server is started with. Deliberately few: everything not named here is left to llama-server's own automatic
 * choices (GPU layers fitted to free memory, flash attention where it helps), which is also what Ollama does and what Jan
 * went back to after pinning the layer count made small GPUs run out of memory.
 */
function serverArgs({ modelPath, mmprojPath, port, key, contextSize, mtp = false, cpuProjector = false }) {
  const args = [
    '-m', modelPath,
    '--host', '127.0.0.1', '--port', String(port), '--api-key', key,
    '-c', String(contextSize),
    '--parallel', '1',
    '--jinja', '--reasoning-format', 'auto',
    '--no-webui', '--no-slots',
    // The model is a local file; this stops llama-server from ever reaching for the network.
    '--offline',
    // Level 4 is what prints which device the model runs on (parsed below); it stays quiet per token.
    '-lv', '4',
    // Prompt checkpoints kept in RAM; the default is far too generous for a desktop app.
    '--cache-ram', '1024',
  ];
  if (mmprojPath) args.push('--mmproj', mmprojPath);
  // The projector stays on the processor when there was no room for it on the graphics card (fallback.js).
  if (mmprojPath && cpuProjector) args.push('--no-mmproj-offload');
  // The model has a multi-token-prediction head: it writes several tokens per step, with the same text and no second model.
  if (mtp) args.push('--spec-type', 'draft-mtp', '--spec-draft-n-max', '3');
  return args;
}

class LlamaEngine extends EventEmitter {
  /**
   * @param {{ directory: string, pidFile?: string, idleMs?: number }} options directory holds
   *   llama-server and its libraries; pidFile lets the next launch clean up
   *   after a crash that orphaned the child; idleMs is how long the model may sit
   *   unused before it is unloaded (idle.js).
   */
  constructor({ directory, pidFile, idleMs }) {
    super();
    this.directory = directory;
    this.binary = binaryIn(directory);
    this.pidFile = pidFile ?? null;
    this.child = null;
    this.current = null; // { modelId, port, key, backend, device }
    this.devicesCache = null;
    this.deviceCount = null; // GPUs found, once known
    this.queue = Promise.resolve();
    this.idle = new IdleWatch({ idleMs, onIdle: () => void this.stop() });
  }

  get available() {
    return fs.existsSync(this.binary);
  }

  get running() {
    return Boolean(this.current && this.child);
  }

  /** Serializes start/stop so two model switches never overlap. */
  _exclusive(task) {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => {});
    return run;
  }

  /** GPUs the engine can use, with memory. Empty means CPU only. */
  devices() {
    this.devicesCache ??= new Promise(resolve => {
      if (!this.available) return resolve([]);
      execFile(this.binary, ['--list-devices'], { cwd: this.directory, timeout: 30_000, windowsHide: true }, (error, stdout, stderr) => {
        resolve(error && !stdout ? [] : parseDevices(`${stdout}\n${stderr}`));
      });
    }).then(list => {
      this.deviceCount = list.length;
      return list;
    });
    return this.devicesCache;
  }

  status() {
    return this.current
      ? { running: true, modelId: this.current.modelId, contextSize: this.current.contextSize, backend: this.current.backend, device: this.current.device, vision: this.current.vision, gpuAvailable: Boolean(this.deviceCount), mtp: this.current.mtp, projectorOnCpu: this.current.projectorOnCpu }
      : { running: false };
  }

  /** A request to the model started or ended: the model is not idle while one is going (idle.js). */
  requestStarted() {
    this.idle.begin();
  }

  requestEnded() {
    this.idle.end();
  }

  /** The loopback address and key the protocol handler forwards to, or null. */
  target() {
    return this.current ? { origin: `http://127.0.0.1:${this.current.port}`, key: this.current.key } : null;
  }

  /** Loads a model (replacing any other) and resolves when it can answer. */
  start({ modelId, modelPath, mmprojPath, contextSize, cpuProjector = false }) {
    return this._exclusive(async () => {
      if (!this.available) throw new EngineError('engine_missing', 'The AI engine isn’t included in this build.');
      if (this.current?.modelId === modelId && this.current.contextSize === contextSize && this.child) return this.status();
      await this._stop();

      const port = await freePort();
      const key = crypto.randomBytes(24).toString('hex');
      const mtp = await hasMtp(modelPath); // read from the file: a model downloaded before the faster files existed has none
      const args = serverArgs({ modelPath, mmprojPath, port, key, contextSize, mtp, cpuProjector });

      const lines = [];
      const info = { gpuLayers: 0, totalLayers: 0, backends: new Set(), device: null };
      const onLine = line => {
        lines.push(line);
        if (lines.length > KEEP_LOG_LINES) lines.shift();
        let match;
        if ((match = /offloaded (\d+)\/(\d+) layers to GPU/.exec(line))) {
          info.gpuLayers = Number(match[1]);
          info.totalLayers = Number(match[2]);
        } else if ((match = /load_backend: loaded (\w+) backend/i.exec(line))) {
          if (match[1].toUpperCase() !== 'CPU') info.backends.add(match[1].toLowerCase());
        } else if ((match = /using device (\S+) \((.+?)\)/.exec(line))) {
          info.device ??= match[2];
        }
      };

      const child = spawn(this.binary, args, { cwd: this.directory, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      this.child = child;
      let exited = null;
      const pipe = stream => {
        let rest = '';
        stream.setEncoding('utf8');
        stream.on('data', chunk => {
          rest += chunk;
          const parts = rest.split(/\r?\n/);
          rest = parts.pop();
          parts.forEach(onLine);
        });
      };
      pipe(child.stdout);
      pipe(child.stderr);
      child.once('error', error => onLine(`spawn error: ${error.message}`));
      child.once('exit', (code, signal) => {
        exited = { code, signal };
        const expected = this.child !== child;
        if (this.child === child) {
          this.child = null;
          this.current = null;
          this._clearPidFile();
        }
        this.emit('exit', { code, signal, expected });
      });
      this._writePidFile(child.pid);

      const deadline = Date.now() + HEALTH_TIMEOUT_MS;
      for (;;) {
        if (exited) {
          const reason = explainFailure(lines);
          throw new EngineError(reason.code, reason.message, lines.slice(-20).join('\n'));
        }
        if (Date.now() > deadline) {
          await this._stop();
          throw new EngineError('load_timeout', 'The model took too long to load.', lines.slice(-20).join('\n'));
        }
        try {
          const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) });
          if (response.status === 200) break;
        } catch {
          // Not listening yet.
        }
        await sleep(250);
      }

      const gpu = info.gpuLayers > 0;
      this.current = {
        modelId,
        contextSize,
        port,
        key,
        backend: gpu ? BACKEND_NAMES[[...info.backends][0]] ?? [...info.backends][0] ?? 'gpu' : 'cpu',
        device: gpu ? info.device : null,
        vision: Boolean(mmprojPath),
        mtp,
        projectorOnCpu: Boolean(mmprojPath && cpuProjector),
      };
      this.idle.start();
      return this.status();
    });
  }

  stop() {
    return this._exclusive(() => this._stop());
  }

  async _stop() {
    this.idle.stop();
    const child = this.child;
    this.child = null;
    this.current = null;
    if (!child || child.exitCode !== null) return this._clearPidFile();
    await new Promise(resolve => {
      const force = setTimeout(() => child.kill('SIGKILL'), 5000);
      child.once('exit', () => {
        clearTimeout(force);
        resolve();
      });
      child.kill();
    });
    this._clearPidFile();
  }

  /** Kills synchronously; for app shutdown, where nothing can be awaited. */
  killNow() {
    this.idle.stop();
    const child = this.child;
    this.child = null;
    this.current = null;
    try {
      child?.kill('SIGKILL');
    } catch {
      // Already gone.
    }
    this._clearPidFile();
  }

  _writePidFile(pid) {
    if (!this.pidFile || !pid) return;
    try {
      fs.writeFileSync(this.pidFile, String(pid));
    } catch {
      // Best effort.
    }
  }

  _clearPidFile() {
    if (this.pidFile) fs.rmSync(this.pidFile, { force: true });
  }

  /**
   * If the last run was killed hard, its llama-server may still be running
   * and holding gigabytes of memory. Ends it, but only if the process with
   * that id really is llama-server (ids get reused).
   */
  async reapStale() {
    if (!this.pidFile || !fs.existsSync(this.pidFile)) return;
    const pid = Number.parseInt(fs.readFileSync(this.pidFile, 'utf8'), 10);
    fs.rmSync(this.pidFile, { force: true });
    if (!Number.isInteger(pid) || pid <= 1) return;
    const name = await new Promise(resolve => {
      const [command, args] =
        process.platform === 'win32'
          ? ['tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']]
          : ['ps', ['-p', String(pid), '-o', 'comm=']];
      execFile(command, args, { timeout: 5000, windowsHide: true }, (error, stdout) => resolve(error ? '' : stdout));
    });
    if (/llama-server/i.test(name)) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Already gone.
      }
    }
  }
}

module.exports = {
  serverArgs, LlamaEngine, EngineError, engineTarget, binaryIn, parseDevices, explainFailure };
