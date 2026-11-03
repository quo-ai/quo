'use strict';

// Makes images on this computer with stable-diffusion.cpp's sd-cli, bundled in engine/<target>/images/ and pinned in
// engine.lock.json (scripts/fetch-engine.js). One image at a time, from model files Quo downloaded itself (ModelStore),
// into a temporary PNG that is read back and deleted. Every argument is built here: the page gives a prompt and a shape,
// never a path, a program or an option.

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

/** The files an image model is made of, as ModelStore keeps them in its folder. */
const IMAGE_FILES = { diffusion: 'diffusion.gguf', text: 'text.gguf', vae: 'vae.safetensors' };
/** Each shape Quo asks for, in pixels (multiples of 64, about a megapixel). */
const SHAPES = {
  '1:1': [1024, 1024],
  '4:3': [1152, 896],
  '3:4': [896, 1152],
  '3:2': [1216, 832],
  '2:3': [832, 1216],
  '16:9': [1344, 768],
  '9:16': [768, 1344],
};
const MAX_PROMPT = 4000;
const TIME_LIMIT_MS = 10 * 60_000;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const OUT_OF_MEMORY = /out of (device )?memory|ErrorOutOfDeviceMemory|failed to allocate|cudaMalloc failed|alloc.*fail/i;

class ImageError extends Error {
  constructor(code, message) {
    super(message ?? code);
    this.code = code;
  }
}

const binaryIn = directory => path.join(directory, process.platform === 'win32' ? 'sd-cli.exe' : 'sd-cli');

/** A prompt as sd-cli gets it: text only, no control characters, not starting with "-" (it would read as an option). */
function cleanPrompt(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').replace(/^[\s-]+/, '').trim().slice(0, MAX_PROMPT);
}

/** sd-cli's arguments for one image: only Quo's own files and checked numbers. */
function imageArgs({ dir, prompt, shape, steps, cfg, seed, output }) {
  const [width, height] = SHAPES[shape];
  return [
    '--diffusion-model', path.join(dir, IMAGE_FILES.diffusion),
    '--llm', path.join(dir, IMAGE_FILES.text),
    '--vae', path.join(dir, IMAGE_FILES.vae),
    '-p', prompt,
    '-W', String(width), '-H', String(height),
    '--steps', String(steps),
    '--cfg-scale', String(cfg),
    '--seed', String(seed),
    '-o', output,
  ];
}

/** The newest "step N/M" in sd-cli's sampling bar (timed in s/it or it/s; loading bars count MB/s), or null. */
function parseProgress(text) {
  const matches = [...String(text).matchAll(/\|\s*(\d+)\/(\d+) - +[\d.]+(?:s\/it|it\/s)/g)];
  const last = matches.at(-1);
  return last ? { step: Number(last[1]), steps: Number(last[2]) } : null;
}

class ImageEngine {
  /** `command` is for tests only: a stand-in program ({ file, args } put before sd-cli's own arguments). */
  constructor({ directory, tmpdir = os.tmpdir(), timeLimitMs = TIME_LIMIT_MS, command = null }) {
    this.directory = directory;
    this.command = command ?? (directory ? { file: binaryIn(directory), args: [] } : null);
    this.tmpdir = tmpdir;
    this.timeLimitMs = timeLimitMs;
    this.child = null;
  }

  get available() {
    return Boolean(this.command) && fs.existsSync(this.command.file);
  }

  get busy() {
    return this.child !== null;
  }

  cancel() {
    this.child?.kill();
  }

  /** Makes one PNG from the model in `dir` (checked by the caller); onProgress gets { step, steps }. */
  make({ dir, prompt, shape, steps, cfg, seed }, onProgress = () => {}) {
    if (this.child) return Promise.reject(new ImageError('busy', 'An image is already being made.'));
    const output = path.join(this.tmpdir, `quo-image-${crypto.randomUUID()}.png`);
    const args = [...this.command.args, ...imageArgs({ dir, prompt, shape, steps, cfg, seed, output })];
    const child = spawn(this.command.file, args, { cwd: this.directory ?? this.tmpdir, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    this.child = child;
    let tail = '';
    const read = chunk => {
      tail = (tail + chunk.toString()).slice(-16_384);
      const progress = parseProgress(tail.slice(-512));
      if (progress) onProgress(progress);
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    const timer = setTimeout(() => child.kill(), this.timeLimitMs);
    return new Promise((resolve, reject) => {
      child.once('error', error => reject(new ImageError('failed', error.message)));
      child.once('exit', async (code, signal) => {
        clearTimeout(timer);
        this.child = null;
        let image = null;
        let failure = null;
        try {
          if (code !== 0) {
            if (OUT_OF_MEMORY.test(tail)) throw new ImageError('out_of_memory', 'Not enough graphics memory for this image.');
            throw new ImageError(signal ? 'stopped' : 'failed', signal ? 'Stopped.' : 'The image couldn’t be made.');
          }
          image = await fsp.readFile(output);
          if (!image.subarray(0, PNG.length).equals(PNG)) throw new ImageError('failed', 'The image couldn’t be made.');
        } catch (error) {
          failure = error instanceof ImageError ? error : new ImageError('failed', 'The image couldn’t be made.');
        }
        // Gone before the answer: the image lives on only in the chat that asked for it.
        await fsp.rm(output, { force: true }).catch(() => {});
        if (failure) reject(failure);
        else resolve(image);
      });
    });
  }
}

module.exports = { ImageEngine, ImageError, IMAGE_FILES, SHAPES, MAX_PROMPT, cleanPrompt, imageArgs, parseProgress, binaryIn };
