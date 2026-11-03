'use strict';

// A local server other apps can use (off by default): the OpenAI-style API on this computer, answered by the model Quo has
// loaded (llama-server). Editors, scripts and tools that speak that API point at http://127.0.0.1:<port>/v1.
//
// What keeps it to the person's own apps:
//   - It listens on 127.0.0.1 only, and answers only when Host is that address: a web page can't reach it by DNS tricks.
//   - Any request with an Origin header (every request a browser makes from a page) is refused, so no website can use it.
//   - It needs the key Quo made (Authorization: Bearer …), compared in constant time.
//   - Only GET /v1/models, POST /v1/chat/completions and POST /v1/completions, bodies up to 16 MB, forwarded to
//     llama-server with llama-server's own key, which never leaves main.
//   - Turning it on is asked about in a native dialog (ipc.js); it is off after a fresh install.

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');

const DEFAULT_PORT = 1235;
const MAX_BODY = 16 * 1024 * 1024;
const FORWARDED = new Set(['/v1/chat/completions', '/v1/completions']);

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(body));
};
const fail = (res, status, message) => json(res, status, { error: { message, type: 'quo_local_server' } });
const sameKey = (given, key) => {
  const a = Buffer.from(String(given));
  const b = Buffer.from(key);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const newKey = () => `quo-${crypto.randomBytes(24).toString('hex')}`;

class LocalApi {
  /**
   * @param {{ settingsFile: string, target: () => ({ origin: string, key: string } | null), status: () => ({ running: boolean, modelId?: string }), activity?: { started(): void, ended(): void } }} options
   */
  constructor({ settingsFile, target, status, activity = { started() {}, ended() {} } }) {
    this.settingsFile = settingsFile;
    this.target = target;
    this.status = status;
    this.activity = activity;
    this.server = null;
    this.saved = this.load();
  }

  load() {
    try {
      const saved = JSON.parse(fs.readFileSync(this.settingsFile, 'utf8'));
      const port = Number.isSafeInteger(saved.port) && saved.port >= 1024 && saved.port <= 65535 ? saved.port : DEFAULT_PORT;
      return { on: saved.on === true, port, key: typeof saved.key === 'string' && /^quo-[0-9a-f]{48}$/.test(saved.key) ? saved.key : newKey() };
    } catch {
      return { on: false, port: DEFAULT_PORT, key: newKey() };
    }
  }

  async save() {
    await fsp.mkdir(path.dirname(this.settingsFile), { recursive: true });
    await fsp.writeFile(this.settingsFile, JSON.stringify(this.saved), { mode: 0o600 });
  }

  /** What the settings show: whether it's on, its address and the key to give other apps. */
  state() {
    return { on: Boolean(this.server), port: this.saved.port, address: `http://127.0.0.1:${this.saved.port}/v1`, key: this.saved.key };
  }

  async start() {
    if (this.server) return this.state();
    const server = http.createServer((req, res) => void this.handle(req, res).catch(() => fail(res, 500, 'Something went wrong.')));
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.saved.port, '127.0.0.1', resolve);
    });
    this.server = server;
    if (!this.saved.on) {
      this.saved.on = true;
      await this.save();
    }
    return this.state();
  }

  async stop() {
    const server = this.server;
    this.server = null;
    if (server) await new Promise(resolve => server.close(() => resolve()));
    if (this.saved.on) {
      this.saved.on = false;
      await this.save();
    }
    return this.state();
  }

  /** A new key: apps using the old one stop working until they get the new one. */
  async renewKey() {
    this.saved.key = newKey();
    await this.save();
    return this.state();
  }

  async setPort(port) {
    if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('bad_port');
    const wasOn = Boolean(this.server);
    if (wasOn) await this.stop();
    this.saved.port = port;
    await this.save();
    return wasOn ? this.start() : this.state();
  }

  async handle(req, res) {
    req.on('error', () => {}); // a client that goes away mid-request is not an error of Quo's
    const port = this.server?.address()?.port ?? this.saved.port;
    if (req.headers.origin !== undefined) return fail(res, 403, 'Requests from web pages are refused. Use this server from an app or a script on this computer.');
    if (req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`) return fail(res, 403, 'Use the address http://127.0.0.1:' + port + '/v1.');
    const auth = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
    if (!auth || !sameKey(auth[1], this.saved.key)) return fail(res, 401, 'Give the key from Quo (Models & storage → Local server) as the API key.');

    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/v1/models') {
      const status = this.status();
      return json(res, 200, { object: 'list', data: status.running && status.modelId ? [{ id: status.modelId, object: 'model', owned_by: 'quo' }] : [] });
    }
    if (req.method !== 'POST' || !FORWARDED.has(url.pathname)) return fail(res, 404, 'This server answers GET /v1/models, POST /v1/chat/completions and POST /v1/completions.');

    const tooLarge = () => {
      res.setHeader('connection', 'close');
      res.on('finish', () => req.destroy());
      return fail(res, 413, 'That request is too large.');
    };
    if (Number(req.headers['content-length'] ?? 0) > MAX_BODY) return tooLarge();
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) return tooLarge();
      chunks.push(chunk);
    }
    const target = this.target();
    if (!target) return fail(res, 503, 'No model is loaded in Quo. Open Quo and start a chat with an offline model.');

    const controller = new AbortController();
    res.on('close', () => controller.abort());
    this.activity.started();
    try {
      const upstream = await fetch(`${target.origin}${url.pathname}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${target.key}` },
        body: Buffer.concat(chunks),
        signal: controller.signal,
      });
      res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' });
      if (upstream.body) for await (const chunk of upstream.body) res.write(chunk);
      res.end();
    } catch {
      if (!res.headersSent) fail(res, 503, 'The model stopped. Try again.');
      else res.end();
    } finally {
      this.activity.ended();
    }
  }
}

module.exports = { LocalApi, DEFAULT_PORT, MAX_BODY };
