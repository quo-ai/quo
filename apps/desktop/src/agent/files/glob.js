'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const { IGNORED_DIRS, isSecretPath, toPosix } = require('../safety');


/** Turns a glob (`*.ts`, `src/**\/*.test.js`, `*.{js,ts}`) into a RegExp, escaping everything else. */
function globToRegExp(glob) {
  let pattern = String(glob).trim().replace(/\\/g, '/');
  if (!pattern.includes('/')) pattern = `**/${pattern}`;
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        i++;
        if (pattern[i + 1] === '/') {
          i++;
          out += '(?:.*/)?';
        } else out += '.*';
      } else out += '[^/]*';
    } else if (char === '?') out += '[^/]';
    else if (char === '{') {
      const close = pattern.indexOf('}', i);
      if (close === -1) out += '\\{';
      else {
        out += `(?:${pattern.slice(i + 1, close).split(',').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`;
        i = close;
      }
    } else out += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`, 'i');
}

/** Every readable file under `start`, skipping dependencies, build output and secrets. */
async function* walkFiles(rootReal, start) {
  async function* visit(directory) {
    let entries;
    try {
      entries = await fsp.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) yield* visit(absolute);
      } else if (entry.isFile()) {
        const relative = toPosix(path.relative(rootReal, absolute));
        if (!isSecretPath(relative)) yield { absolute, relative };
      }
    }
  }
  yield* visit(start);
}

module.exports = { globToRegExp, walkFiles };
