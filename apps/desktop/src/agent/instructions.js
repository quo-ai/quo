'use strict';

const fsp = require('node:fs/promises');
const { IGNORED_DIRS, isSecretPath, looksBinary, redactSecrets, resolveInside } = require('./safety');

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

const MAX_SCOPED = 3; // notes from folders below the top, per session
const SCOPED_CHARS = 3000;

/**
 * Notes kept in a folder below the project's top (`packages/api/AGENTS.md`) apply to the files in that folder. When the
 * agent first reads or changes a file there, the notes come with the result, once per folder, the way the top ones come
 * with the prompt. Dependencies and build output are never looked in (a package's own notes are someone else's words),
 * and the same caps and cleaning apply. `seen` is the set of folders already looked at in this session.
 */
async function readScopedNotes(rootReal, relativePath, seen) {
  const parts = String(relativePath).split('/').filter(Boolean).slice(0, -1);
  if (parts.some(part => IGNORED_DIRS.has(part)) || isSecretPath(parts.join('/'))) return [];
  const found = [];
  for (let depth = 1; depth <= parts.length && seen.size < MAX_SCOPED * 4; depth++) {
    const dir = parts.slice(0, depth).join('/');
    if (seen.has(dir)) continue;
    seen.add(dir);
    for (const name of FILES) {
      try {
        const { absolute } = resolveInside(rootReal, `${dir}/${name}`);
        const stat = await fsp.stat(absolute);
        if (!stat.isFile() || stat.size > MAX_READ_BYTES) continue;
        const buffer = await fsp.readFile(absolute);
        if (looksBinary(buffer)) continue;
        let text = redactSecrets(buffer.toString('utf8')).trim();
        for (let before = ''; before !== text;) {
          before = text;
          text = text.replace(/<\/?project-notes>/gi, ''); // removing one tag must not be able to assemble another
        }
        if (!text) continue;
        found.push({ dir, file: name, text: text.length > SCOPED_CHARS ? `${text.slice(0, SCOPED_CHARS)}\n… [the rest of ${name} is left out]` : text });
        break;
      } catch {
        // Not there, or not allowed: try the next name.
      }
    }
    if (found.length >= MAX_SCOPED) break;
  }
  return found;
}

module.exports = { readInstructions, readScopedNotes, MAX_CHARS, SCOPED_CHARS };
