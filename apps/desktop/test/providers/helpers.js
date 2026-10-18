'use strict';

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const temp = () => fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'quo-providers-')));

/** A stand-in for the operating system's secure storage: reversible, and not the plain text. */
const fakeSafeStorage = (backend = 'gnome_libsecret', available = true) => ({
  isEncryptionAvailable: () => available,
  getSelectedStorageBackend: () => backend,
  encryptString: text => Buffer.from(`enc:${[...text].reverse().join('')}`),
  decryptString: buffer => {
    const text = buffer.toString();
    if (!text.startsWith('enc:')) throw new Error('cannot decrypt');
    return [...text.slice(4)].reverse().join('');
  },
});

/** A real HTTP server on this computer. `handler` gets each request; `seen` records them. */
async function server(handler) {
  const seen = [];
  const sockets = new Set();
  const instance = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const record = { method: request.method, url: request.url, headers: request.headers, body: Buffer.concat(chunks).toString('utf8'), closed: false };
    seen.push(record);
    request.socket.on('close', () => { record.closed = true; });
    await handler(request, response, record);
  });
  instance.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise(resolve => instance.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${instance.address().port}`, seen, close: () => { for (const socket of sockets) socket.destroy(); instance.close(); } };
}

/** Collects the events a request sends back, and resolves once it has ended. */
function collector() {
  const events = [];
  let done;
  const finished = new Promise(resolve => { done = resolve; });
  return {
    events,
    emit: event => { events.push(event); if (event.type === 'end' || event.type === 'error') done(event); },
    finished,
    text: () => Buffer.concat(events.filter(e => e.type === 'chunk').map(e => Buffer.from(e.data))).toString('utf8'),
  };
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

module.exports = { temp, fakeSafeStorage, server, collector, wait };
