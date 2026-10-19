'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { AgentError, IGNORED_DIRS, inside, isSecretPath, looksBinary, resolveInside, toPosix } = require('../safety');
const { BROWSER_FILES } = require('../open');

/**
 * What the file panel shows the person: a folder's entries, one file's contents, whether paths exist. It is for looking,
 * asked for by the person's own clicks (through the page), and it keeps every rule the agent's own reading has: only
 * inside the project, links that lead out are left out, secrets files and `.git` are neither listed nor opened. It never
 * changes anything and doesn't touch what the agent has read (so it can't unlock an edit).
 */

const MAX_ENTRIES = 500;
const MAX_TEXT_BYTES = 400 * 1024;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_EXISTS = 200;
const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml' };

/** The entries of a folder in the project (folders first), with what to leave out already left out. */
async function listEntries(ctx, input = '.') {
  const { absolute, relative } = resolveInside(ctx.rootReal, input);
  const stat = await fsp.stat(absolute);
  if (!stat.isDirectory()) throw new AgentError('not_folder', `${relative} isn’t a folder.`);
  if (relative !== '.' && isSecretPath(relative)) throw new AgentError('secret', `${relative} holds keys or credentials, so Quo doesn’t show it.`);
  const dirents = await fsp.readdir(absolute, { withFileTypes: true });
  const entries = [];
  for (const dirent of dirents) {
    const child = relative === '.' ? dirent.name : `${relative}/${dirent.name}`;
    if (isSecretPath(child)) continue;
    let isDir = dirent.isDirectory();
    if (dirent.isSymbolicLink()) {
      try {
        const real = fs.realpathSync.native(path.join(absolute, dirent.name));
        if (!inside(path.relative(ctx.rootReal, real))) continue; // a link out of the project isn't shown
        isDir = fs.statSync(real).isDirectory();
      } catch {
        continue;
      }
    } else if (!dirent.isFile() && !dirent.isDirectory()) continue;
    entries.push({ name: dirent.name, path: child, dir: isDir, ignored: isDir && IGNORED_DIRS.has(dirent.name) });
  }
  entries.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
  return { path: relative, entries: entries.slice(0, MAX_ENTRIES), truncated: entries.length > MAX_ENTRIES };
}

/** One file for the viewer: its text (clipped), an image as a data address, or why it can't be shown. */
async function viewFile(ctx, input) {
  if (!input) throw new AgentError('bad_args', 'Which file?');
  const { absolute, relative } = resolveInside(ctx.rootReal, input);
  if (isSecretPath(relative)) throw new AgentError('secret', `${relative} looks like a secrets file (keys, credentials or .env), so Quo doesn’t show it.`);
  const stat = await fsp.stat(absolute);
  if (stat.isDirectory()) throw new AgentError('not_file', `${relative} is a folder.`);
  const extension = path.extname(absolute).toLowerCase();
  const base = { path: relative, size: stat.size, canOpen: BROWSER_FILES.has(extension) };
  if (IMAGE_TYPES[extension]) {
    if (stat.size > MAX_IMAGE_BYTES) return { ...base, kind: 'toolarge' };
    const data = await fsp.readFile(absolute);
    return { ...base, kind: 'image', dataUrl: `data:${IMAGE_TYPES[extension]};base64,${data.toString('base64')}` };
  }
  const handle = await fsp.open(absolute, 'r');
  try {
    const { bytesRead, buffer } = await handle.read(Buffer.alloc(Math.min(stat.size, MAX_TEXT_BYTES)), 0, Math.min(stat.size, MAX_TEXT_BYTES), 0);
    const bytes = buffer.subarray(0, bytesRead);
    if (looksBinary(bytes)) return { ...base, kind: 'binary' };
    const text = bytes.toString('utf8');
    return { ...base, kind: 'text', text, lines: text.split('\n').length, clipped: stat.size > MAX_TEXT_BYTES };
  } finally {
    await handle.close();
  }
}

/** Which of these project paths are real files (an absolute path inside the project counts), for turning mentions in chat into links. */
function existing(ctx, paths) {
  const found = [];
  for (const raw of (Array.isArray(paths) ? paths : []).slice(0, MAX_EXISTS)) {
    if (typeof raw !== 'string' || raw.length > 400) continue;
    try {
      const { absolute, relative } = resolveInside(ctx.rootReal, raw);
      if (isSecretPath(relative) || relative === '.') continue;
      if (fs.statSync(absolute).isFile()) found.push(raw);
    } catch {
      // Not a file, not allowed, or not there.
    }
  }
  return found;
}

module.exports = { listEntries, viewFile, existing, toPosix, MAX_ENTRIES, MAX_TEXT_BYTES };
