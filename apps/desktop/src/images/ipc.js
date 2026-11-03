'use strict';

// Images made on this computer, for the app's own pages only (images:make, images:cancel). The page names an image model
// it downloaded (its id), a prompt and a shape. Main checks the model's files are whole files Quo downloaded, builds every
// argument itself (engine.js) and returns the PNG as a data address. If the graphics card runs out of memory while a chat
// model is loaded, the chat model is set aside and the image is tried once more; the next message loads it again.

const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ipcMain } = require('electron');
const { trusted } = require('../trust');
const { ModelError, hasModelHeader } = require('../engine/models');
const { ImageEngine, ImageError, IMAGE_FILES, SHAPES, cleanPrompt } = require('./engine');

const imagesDirectory = engineDirectory => (engineDirectory ? path.join(engineDirectory, 'images') : null);
const whole = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;

const MAX_REFERENCE_BYTES = 12 * 1024 * 1024;
const KINDS = { png: [0x89, 0x50, 0x4e, 0x47], jpeg: [0xff, 0xd8, 0xff], webp: [0x52, 0x49, 0x46, 0x46] };
/** A picture to change, from the page's data address: PNG, JPEG or WebP whose bytes say so, at most 12 MB. */
function imageBytes(value) {
  const match = typeof value === 'string' ? /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(value) : null;
  if (!match || match[2].length > Math.ceil(MAX_REFERENCE_BYTES / 3) * 4) throw new ImageError('bad_reference', 'That picture can’t be changed here.');
  const bytes = Buffer.from(match[2], 'base64');
  const magic = KINDS[match[1]];
  if (bytes.length > MAX_REFERENCE_BYTES || !magic.every((byte, i) => bytes[i] === byte) || (match[1] === 'webp' && bytes.subarray(8, 12).toString() !== 'WEBP')) {
    throw new ImageError('bad_reference', 'That picture can’t be changed here.');
  }
  return { bytes, extension: match[1] === 'jpeg' ? 'jpg' : match[1] };
}

/** The request as main will use it, or an ImageError. Anything not listed here is ignored. */
function checkRequest(payload) {
  const prompt = cleanPrompt(payload?.prompt);
  if (!prompt) throw new ImageError('bad_prompt', 'Say what the image should show.');
  const shape = typeof payload.aspect === 'string' && Object.hasOwn(SHAPES, payload.aspect) ? payload.aspect : null;
  if (!shape) throw new ImageError('bad_shape', 'That image shape isn’t offered.');
  if (typeof payload.modelId !== 'string') throw new ImageError('not_installed', 'Download an image model first.');
  const steps = whole(payload.steps, 1, 50) ? payload.steps : 8;
  const cfg = typeof payload.cfg === 'number' && Number.isFinite(payload.cfg) && payload.cfg >= 0 && payload.cfg <= 20 ? payload.cfg : 1;
  const seed = whole(payload.seed, 0, 2 ** 31 - 1) ? payload.seed : Math.floor(Math.random() * 2 ** 31);
  const quick = payload.size === 'quick';
  const reference = payload.reference === undefined || payload.reference === null ? null : imageBytes(payload.reference);
  return { modelId: payload.modelId, prompt, shape, steps, cfg, seed, quick, reference };
}

/** The model's folder, once every file it needs is there, whole, and of its own kind. */
async function modelFolder(store, modelId) {
  const dir = store.dirFor(modelId); // throws on an id that isn't a plain name
  for (const name of Object.values(IMAGE_FILES)) {
    if (!(await hasModelHeader(store.filePath(modelId, name)))) throw new ImageError('not_installed', 'Download the image model first.');
  }
  return dir;
}

/**
 * @param {{ store: import('../engine/models').ModelStore, engineDirectory: string | null, stopChat?: () => Promise<unknown>, ipc?: { handle: Function } }} options
 */
function setupImages({ store, engineDirectory, stopChat, ipc = ipcMain, engine = new ImageEngine({ directory: imagesDirectory(engineDirectory) }) }) {
  if (!engine.available) return { available: false };

  const handle = (channel, task) =>
    ipc.handle(channel, async (event, payload) => {
      if (!trusted(event)) return { error: { code: 'untrusted', message: 'Not allowed.' } };
      try {
        return { ok: await task(payload ?? {}, event) };
      } catch (error) {
        if (error instanceof ImageError || error instanceof ModelError) return { error: { code: error.code, message: error.message } };
        console.warn(`[${channel}]`, error);
        return { error: { code: 'failed', message: 'The image couldn’t be made.' } };
      }
    });

  handle('images:make', async (payload, event) => {
    const request = checkRequest(payload);
    const dir = await modelFolder(store, request.modelId);
    const progress = update => {
      if (!event.sender.isDestroyed?.()) event.sender.send('images:event', { type: 'progress', ...update });
    };
    // A picture to change goes to sd-cli as a file of its own, removed once the image is made (or isn't).
    const reference = request.reference ? path.join(os.tmpdir(), `quo-reference-${crypto.randomUUID()}.${request.reference.extension}`) : null;
    if (reference) await fsp.writeFile(reference, request.reference.bytes, { mode: 0o600 });
    const job = { ...request, dir, reference };
    let png;
    let setAside = false;
    try {
      try {
        png = await engine.make(job, progress);
      } catch (error) {
        if (!(error instanceof ImageError) || error.code !== 'out_of_memory' || !stopChat) throw error;
        await stopChat();
        setAside = true; // the page says so under the image
        png = await engine.make(job, progress);
      }
    } finally {
      if (reference) await fsp.rm(reference, { force: true });
    }
    return { image: `data:image/png;base64,${png.toString('base64')}`, seed: request.seed, setAside };
  });
  handle('images:cancel', () => engine.cancel());

  return { available: true, engine };
}

module.exports = { setupImages, checkRequest, imageBytes, modelFolder, imagesDirectory };
