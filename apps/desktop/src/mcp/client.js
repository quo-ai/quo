'use strict';

// One tool server (MCP), run as a process on this computer and spoken to over its standard input and output: one JSON-RPC
// message per line. Quo asks it for its tools and calls them; it may ask Quo nothing but `ping` (no files, no model, no
// questions to the person). Started only by manager.js, for a server the person approved.

const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');

const PROTOCOL = '2025-06-18';
const MAX_LINE = 8 * 1024 * 1024;
const MAX_TOOLS = 100;
const START_MS = 90_000; // npx and uvx may download the server the first time
const CALL_MS = 120_000;
const STDERR_LINES = 30;

class McpError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** Quotes one word for cmd.exe, which starts .cmd launchers (npx, uvx) on Windows: Node won't run those directly. */
const quoteForCmd = word => (word === '' || /[\s"&|<>^()%!,;=]/.test(word) ? `"${word.replace(/"/g, '""')}"` : word);

/** How to start `command` here: directly, or on Windows (anything but an .exe) through cmd.exe so PATHEXT finds it. */
function launch(command, args, platform = process.platform) {
  if (platform !== 'win32' || /\.exe$/i.test(command)) return { file: command, args, verbatim: false };
  return { file: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', `"${[command, ...args].map(quoteForCmd).join(' ')}"`], verbatim: true };
}

class McpClient extends EventEmitter {
  /** @param {{ name: string, command: string, args: string[], env: Record<string,string>, cwd: string, version: string, platform?: string, spawnImpl?: typeof spawn }} options */
  constructor({ name, command, args, env, cwd, version, platform = process.platform, spawnImpl = spawn }) {
    super();
    Object.assign(this, { name, command, args, env, cwd, version, platform, spawnImpl });
    this.child = null;
    this.pending = new Map();
    this.nextId = 1;
    this.buffer = '';
    this.stderr = [];
    this.tools = [];
    this.closed = false;
  }

  /** The last thing the server wrote about itself, for an error message. */
  lastWords() {
    return this.stderr.filter(line => line.trim()).at(-1)?.slice(0, 300) ?? '';
  }

  async start() {
    const { file, args, verbatim } = launch(this.command, this.args, this.platform);
    const child = this.spawnImpl(file, args, { cwd: this.cwd, env: this.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, windowsVerbatimArguments: verbatim, detached: this.platform !== 'win32' });
    this.child = child;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => this.receive(chunk));
    child.stderr.on('data', chunk => {
      this.stderr.push(...String(chunk).split(/\r?\n/));
      if (this.stderr.length > STDERR_LINES) this.stderr.splice(0, this.stderr.length - STDERR_LINES);
    });
    child.stdin.on('error', () => {});
    child.once('error', error => this.gone(error?.code === 'ENOENT' ? `“${this.command}” wasn’t found. Install it, or give its full path.` : 'The tool server couldn’t be started.'));
    child.once('exit', () => this.gone(`The tool server stopped.${this.lastWords() ? ` It said: ${this.lastWords()}` : ''}`));

    await this.request('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'Quo', version: this.version } }, { timeoutMs: START_MS });
    this.notify('notifications/initialized');
    await this.refreshTools();
  }

  async refreshTools() {
    const tools = [];
    let cursor;
    for (let page = 0; page < 10 && tools.length < MAX_TOOLS; page++) {
      const result = await this.request('tools/list', cursor ? { cursor } : {}, { timeoutMs: START_MS });
      if (Array.isArray(result?.tools)) tools.push(...result.tools);
      cursor = typeof result?.nextCursor === 'string' && result.nextCursor ? result.nextCursor : null;
      if (!cursor) break;
    }
    this.tools = tools.slice(0, MAX_TOOLS).filter(tool => tool && typeof tool.name === 'string');
    this.emit('tools', this.tools);
  }

  /** Calls a tool; the result as the server gave it ({ content, isError, structuredContent }). */
  call(tool, args, { signal, timeoutMs = CALL_MS } = {}) {
    return this.request('tools/call', { name: tool, arguments: args }, { signal, timeoutMs });
  }

  request(method, params, { signal, timeoutMs = CALL_MS } = {}) {
    if (this.closed || !this.child) return Promise.reject(new McpError('stopped', 'The tool server isn’t running.'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const done = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        this.pending.delete(id);
      };
      const timer = setTimeout(() => {
        done();
        this.notify('notifications/cancelled', { requestId: id, reason: 'timeout' });
        reject(new McpError('timeout', 'The tool server took too long to answer.'));
      }, timeoutMs);
      const abort = () => {
        done();
        this.notify('notifications/cancelled', { requestId: id, reason: 'stopped' });
        reject(new McpError('stopped', 'Stopped.'));
      };
      if (signal?.aborted) return abort();
      signal?.addEventListener('abort', abort, { once: true });
      this.pending.set(id, { resolve: value => (done(), resolve(value)), reject: error => (done(), reject(error)) });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method, params) {
    this.send({ jsonrpc: '2.0', method, ...(params ? { params } : {}) });
  }

  send(message) {
    if (this.closed || !this.child?.stdin.writable) return;
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  receive(chunk) {
    this.buffer += chunk;
    if (this.buffer.length > MAX_LINE && !this.buffer.includes('\n')) return this.fail('The tool server sent a message that is too large.');
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue; // a server that logs to its output by mistake: not a message
      }
      this.handle(message);
    }
  }

  handle(message) {
    if (!message || typeof message !== 'object') return;
    if (message.method && message.id !== undefined) {
      // The server asking Quo something. Only `ping` is answered: Quo offers no roots, sampling or questions to the person.
      if (message.method === 'ping') return this.send({ jsonrpc: '2.0', id: message.id, result: {} });
      return this.send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Quo does not offer this.' } });
    }
    if (message.method === 'notifications/tools/list_changed') return void this.refreshTools().catch(() => {});
    if (message.method) return;
    const waiting = this.pending.get(message.id);
    if (!waiting) return;
    if (message.error) waiting.reject(new McpError('tool_error', String(message.error.message ?? 'The tool server reported an error.').slice(0, 500)));
    else waiting.resolve(message.result ?? {});
  }

  fail(reason) {
    this.gone(reason);
    this.close();
  }

  gone(reason) {
    if (this.closed && !this.pending.size) return;
    for (const waiting of [...this.pending.values()]) waiting.reject(new McpError('stopped', reason));
    this.pending.clear();
    if (!this.closed) {
      this.closed = true;
      this.emit('exit', reason);
    }
  }

  /** Stops the server and anything it started (npx runs the real server as a child). */
  close() {
    const child = this.child;
    this.closed = true;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    try {
      child.stdin.end();
    } catch {
      // Already closed.
    }
    if (this.platform === 'win32') {
      this.spawnImpl('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on?.('error', () => {});
      return;
    }
    const kill = signal => {
      try {
        process.kill(-child.pid, signal);
      } catch {
        try {
          child.kill(signal);
        } catch {
          // Gone.
        }
      }
    };
    kill('SIGTERM');
    setTimeout(() => child.exitCode === null && child.signalCode === null && kill('SIGKILL'), 3000).unref?.();
  }
}

module.exports = { McpClient, McpError, launch, quoteForCmd, PROTOCOL };
