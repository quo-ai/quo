'use strict';

// Documents in a project folder (PDF, Word, PowerPoint, Excel, OpenDocument) read as text by Code mode's read_file and
// search_text. Main checks the path (resolveInside, secrets) and reads the bytes; the text is taken out in a process of
// its own (extract-worker.mjs) that can read only its own code, can't write or start anything, and is stopped if it takes
// too long. Text is kept for a while, per file and version, so a second read or search is quick.

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

/** A real folder for a file in the app: modules the worker loads must be outside app.asar for Node to read them itself. */
const unpacked = file => file.replace(/([\\/])app\.asar(?=[\\/]|$)/, '$1app.asar.unpacked');

class DocumentReader {
  constructor({ execPath = process.execPath, electron = Boolean(process.versions.electron), worker = path.join(__dirname, 'extract-worker.mjs'), timeoutMs = TIMEOUT_MS } = {}) {
    this.execPath = execPath;
    this.electron = electron;
    this.worker = worker;
    this.timeoutMs = timeoutMs;
    this.child = null;
    this.waiting = new Map();
    this.nextId = 1;
    this.buffer = '';
    this.idle = null;
    this.cache = new Map(); // `${file}:${size}:${mtime}` → text, oldest first
    this.cached = 0;
  }

  start() {
    const worker = unpacked(this.worker);
    // Quo's own folder (the app's code and its modules), read only: not the person's files, which arrive as bytes.
    const appRoot = unpacked(path.resolve(__dirname, '..', '..', '..'));
    const child = spawn(this.execPath, [
      '--max-old-space-size=1024',
      '--disallow-code-generation-from-strings',
      '--permission', // Node's permission model: no writing, no programs, no workers, no native add-ons
      `--allow-fs-read=${appRoot}`,
      worker,
    ], {
      env: { ...(this.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}), NODE_OPTIONS: '', ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot ?? 'C:\\Windows' } : {}) },
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true,
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => this.receive(chunk));
    child.stdin.on('error', () => {});
    const gone = () => {
      if (this.child !== child) return;
      this.child = null;
      for (const { reject } of this.waiting.values()) reject(new AgentError('document_failed', 'The document reader stopped. Try again, or read a smaller document.'));
      this.waiting.clear();
    };
    child.once('exit', gone);
    child.once('error', gone);
    this.child = child;
  }

  receive(chunk) {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    for (const line of lines) {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      const waiting = this.waiting.get(message.id);
      if (!waiting) continue;
      this.waiting.delete(message.id);
      if (typeof message.text === 'string') waiting.resolve(message.text);
      else waiting.reject(new AgentError('document_failed', String(message.error ?? 'This document couldn’t be read.').slice(0, 300)));
    }
    this.restIfIdle();
  }

  restIfIdle() {
    clearTimeout(this.idle);
    if (this.waiting.size) return;
    this.idle = setTimeout(() => this.stop(), IDLE_MS);
    this.idle.unref?.();
  }

  /** The text of one document's bytes, from the worker. */
  extract(kind, bytes) {
    if (!this.child) this.start();
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
      this.child.stdin.write(`${JSON.stringify({ id, kind, data: bytes.toString('base64') })}\n`);
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

  stop() {
    clearTimeout(this.idle);
    const child = this.child;
    this.child = null;
    for (const { reject } of this.waiting.values()) reject(new AgentError('document_failed', 'The document reader stopped.'));
    this.waiting.clear();
    try {
      child?.kill();
    } catch {
      // Gone.
    }
  }
}

/** One reader for the app: documents are read one at a time. */
const reader = new DocumentReader();

module.exports = { DocumentReader, reader, documentKind, MAX_DOCUMENT_BYTES, KINDS };
