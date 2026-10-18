'use strict';

const fsp = require('node:fs/promises');
const { looksBinary, redactSecrets, resolveInside } = require('./safety');

/**
 * Notes a project keeps for coding agents (AGENTS.md, or CLAUDE.md): how to build and test, what the code
 * style is. Only the project's top folder is looked at, the file has to really be inside the project (a link
 * to somewhere else doesn't count), and what is read is capped and cleaned of secrets. They are the project's
 * own words, so they reach the model as notes, never as rules: the server's prompt says they can't change
 * how Quo behaves.
 */

const FILES = ['AGENTS.md', 'CLAUDE.md'];
const MAX_READ_BYTES = 64 * 1024;
const MAX_CHARS = 8000;

async function readInstructions(rootReal) {
  for (const name of FILES) {
    try {
      const { absolute } = resolveInside(rootReal, name);
      const stat = await fsp.stat(absolute);
      if (!stat.isFile() || stat.size > MAX_READ_BYTES) continue;
      const buffer = await fsp.readFile(absolute);
      if (looksBinary(buffer)) continue;
      const text = redactSecrets(buffer.toString('utf8')).trim();
      if (!text) continue;
      return { file: name, text: text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n… [the rest of ${name} is left out]` : text };
    } catch {
      // Not there, or not allowed: try the next name.
    }
  }
  return null;
}

module.exports = { readInstructions, MAX_CHARS };
