// The document reader outside Electron (tests, plain Node): extract.mjs in a process under Node's permission model
// (documents.js starts it), which can read only Quo's own folder and gets each document's bytes from its parent.
// One JSON message per line on stdin: { id, kind, data (base64) }. One per line back: { id, text } or { id, error }.

import readline from 'node:readline';
import { extractText } from './extract.mjs';

let queue = Promise.resolve();
readline.createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', line => {
  queue = queue.then(async () => {
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      return;
    }
    try {
      const text = await extractText(request.kind, new Uint8Array(Buffer.from(String(request.data), 'base64')));
      process.stdout.write(`${JSON.stringify({ id: request.id, text })}\n`);
    } catch (error) {
      process.stdout.write(`${JSON.stringify({ id: request.id, error: error.message })}\n`);
    }
  });
});
