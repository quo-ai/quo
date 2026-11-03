'use strict';

// Documents in a project folder (PDF, Word, PowerPoint, Excel, OpenDocument) read as text by Code mode's read_file and
// search_text. Main checks the path (resolveInside, secrets) and reads the bytes; the text is taken out elsewhere, never
// in main: in the app, a hidden sandboxed window with no Node (reader/window.js); in tests and plain Node, a process under
// Node's permission model (reader/node-worker.mjs). Either is stopped when a document takes too long. Text is kept per
// file and version, so a second read or search is quick.

const { spawn } = require('node:child_process');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { AgentError } = require('../safety');

const KINDS = { '.pdf': 'pdf', '.docx': 'docx', '.pptx': 'pptx', '.xlsx': 'xlsx', '.odt': 'odf', '.odp': 'odf', '.ods': 'odf' };
const MAX_DOCUMENT_BYTES = 40 * 1024 * 1024;
const TIMEOUT_MS = 30_000;
const IDLE_MS = 60_000;
const CACHE_CHARS = 20_000_000;

/** 'pdf', 'docx', … for a document Quo can read as text, or null. */
const documentKind = file => KINDS[path.extname(String(file)).toLowerCase()] ?? null;

/** Outside Electron: the reader as a Node process that can read only Quo's own folder, and can't write or start anything. */
class NodeTransport {
  constructor({ onReply, onGone, worker }) {
    Object.assign(this, { onReply, onGone, worker });
    this.child = null;
    this.buffer = '';
  }

  start() {
    const appRoot = path.resolve(__dirname, '..', '..', '..');
    const child = spawn(process.execPath, [
      '--max-old-space-size=1024',
      '--disallow-code-generation-from-strings',
      '--permission', // Node's permission model: no writing, no programs, no workers, no native add-ons
      `--allow-fs-read=${appRoot}`,
      this.worker,
    ], { env: { NODE_OPTIONS: '', ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot ?? 'C:\\Windows' } : {}) }, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      this.buffer += chunk;
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop() ?? '';
      for (const line of lines) {
        try {
          const message = JSON.parse(line);
          this.onReply(Number(message.id), message);
        } catch {
          // Not a message.
        }
      }
    });
    child.stdin.on('error', () => {});
    const gone = () => {
      if (this.child !== child) return;
      this.child = null;
      this.onGone('The document reader stopped.');
    };
    child.once('exit', gone);
    child.once('error', gone);
    this.child = child;
  }

  async send(id, kind, bytes) {
    if (!this.child) this.start();
    this.child.stdin.write(`${JSON.stringify({ id, kind, data: Buffer.from(bytes).toString('base64') })}\n`);
  }

  get running() {
    return Boolean(this.child);
  }

  stop() {
    const child = this.child;
    this.child = null;
    try {
      child?.kill();
    } catch {
      // Gone.
    }
  }
}

const inElectronMain = () => Boolean(process.versions.electron) && process.type === 'browser';

class DocumentReader {
  /** @param {{ worker?: string, timeoutMs?: number, transport?: 'window' | 'node' }} options */
  constructor({ worker = path.join(__dirname, 'reader', 'node-worker.mjs'), timeoutMs = TIMEOUT_MS, transport = inElectronMain() ? 'window' : 'node' } = {}) {
    this.timeoutMs = timeoutMs;
    const hooks = { onReply: (id, result) => this.reply(id, result), onGone: reason => this.lost(reason), worker };
    this.transport = transport === 'window' ? new (require('./reader/window').WindowTransport)(hooks) : new NodeTransport(hooks);
    this.waiting = new Map();
    this.nextId = 1;
    this.idle = null;
    this.cache = new Map(); // `${file}:${size}:${mtime}` → text, oldest first
    this.cached = 0;
  }

  reply(id, result) {
    const waiting = this.waiting.get(id);
    if (!waiting) return;
    this.waiting.delete(id);
    if (typeof result.text === 'string') waiting.resolve(result.text);
    else waiting.reject(new AgentError('document_failed', String(result.error ?? 'This document couldn’t be read.').slice(0, 300)));
    this.restIfIdle();
  }

  lost(reason) {
    for (const { reject } of this.waiting.values()) reject(new AgentError('document_failed', `${reason} Try again, or read a smaller document.`));
    this.waiting.clear();
  }

  restIfIdle() {
    clearTimeout(this.idle);
    if (this.waiting.size) return;
    this.idle = setTimeout(() => this.stop(), IDLE_MS);
    this.idle.unref?.();
  }

  /** The text of one document's bytes, from the reader. */
  extract(kind, bytes) {
    clearTimeout(this.idle);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // A document that keeps the reader busy (a crafted PDF) is given up on, with the reader.
        this.waiting.delete(id);
        reject(new AgentError('document_slow', 'This document took too long to read.'));
        this.stop();
      }, this.timeoutMs);
      this.waiting.set(id, { resolve: text => (clearTimeout(timer), resolve(text)), reject: error => (clearTimeout(timer), reject(error)) });
      this.transport.send(id, kind, bytes).catch(error => this.reply(id, { error: error?.message ?? 'The document reader didn’t start.' }));
    });
  }

  /** The text of the document at `absolute` (already checked by the caller), from the cache while the file is unchanged. */
  async text(absolute, relative) {
    const kind = documentKind(absolute);
    if (!kind) throw new AgentError('binary', `${relative} is a binary file.`);
    const stat = await fsp.stat(absolute);
    if (stat.size > MAX_DOCUMENT_BYTES) throw new AgentError('too_large', `${relative} is too large to read (the limit for documents is 40 MB).`);
    const key = `${absolute}:${stat.size}:${stat.mtimeMs}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const text = (await this.extract(kind, await fsp.readFile(absolute))).replace(/\r\n/g, '\n');
    this.cache.set(key, text);
    this.cached += text.length;
    for (const [old, value] of this.cache) {
      if (this.cached <= CACHE_CHARS) break;
      this.cache.delete(old);
      this.cached -= value.length;
    }
    return text;
  }

  get running() {
    return this.transport.running;
  }

  stop() {
    clearTimeout(this.idle);
    this.transport.stop();
    this.lost('The document reader stopped.');
  }
}

/** One reader for the app, made when first used: documents are read one at a time. */
let shared = null;
const reader = {
  text: (absolute, relative) => (shared ??= new DocumentReader()).text(absolute, relative),
  extract: (kind, bytes) => (shared ??= new DocumentReader()).extract(kind, bytes),
  stop: () => shared?.stop(),
};

module.exports = { DocumentReader, reader, documentKind, MAX_DOCUMENT_BYTES, KINDS };
