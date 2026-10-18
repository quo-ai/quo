'use strict';

const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const { AgentError, IGNORED_DIRS, isSecretPath, looksBinary, redactSecrets, resolveInside, toPosix } = require('./safety');

/**
 * The file tools Code mode gives the model. Each takes a `ctx` ({ rootReal, reads }):
 * the project's real path, and what this session has read (an edit needs a read first,
 * and the file must not have changed since). Reading is free; writing is planned here
 * (`planEdit`, `planWrite`) and only applied (`applyPlan`) once the user has said yes.
 */

const LIMITS = {
  maxFileBytes: 2 * 1024 * 1024,
  maxWriteBytes: 1024 * 1024,
  readLines: 400,
  outputChars: 60_000,
  lineChars: 500,
  listEntries: 300,
  findResults: 200,
  searchResults: 100,
  searchFiles: 20_000,
  searchBudgetMs: 10_000,
  regexBudgetMs: 400,
  patternChars: 300,
};

const sha = text => crypto.createHash('sha256').update(text).digest('hex');
const integer = (value, fallback, min, max) => (Number.isFinite(Number(value)) && value !== null && value !== '' ? Math.min(max, Math.max(min, Math.trunc(Number(value)))) : fallback);
const clip = (line, max = LIMITS.lineChars) => (line.length > max ? `${line.slice(0, max)}… [line cut]` : line);
const sizeLabel = bytes => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} B`);

function limitOutput(text) {
  if (text.length <= LIMITS.outputChars) return text;
  return `${text.slice(0, LIMITS.outputChars)}\n… [output cut at ${LIMITS.outputChars.toLocaleString('en-US')} characters. Ask for a smaller range or a narrower search.]`;
}

/** Lists a folder, optionally a few levels down. */
async function listDirectory(ctx, { path: input = '.', depth } = {}) {
  const { absolute, relative } = resolveInside(ctx.rootReal, input);
  const stat = await fsp.stat(absolute);
  if (!stat.isDirectory()) throw new AgentError('not_directory', `${relative} is a file, not a folder. Use read_file.`);
  const levels = integer(depth, 1, 1, 3);
  const lines = [];
  let count = 0;
  let cut = false;

  async function walk(directory, prefix, level) {
    const entries = (await fsp.readdir(directory, { withFileTypes: true })).sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (count >= LIMITS.listEntries) {
        cut = true;
        return;
      }
      count++;
      const name = entry.name;
      if (entry.isDirectory()) {
        const skipped = IGNORED_DIRS.has(name);
        lines.push(`${prefix}${name}/${skipped ? ' (skipped: dependencies or build output)' : ''}`);
        if (!skipped && level < levels) await walk(path.join(directory, name), `${prefix}  `, level + 1);
      } else if (entry.isSymbolicLink()) {
        lines.push(`${prefix}${name} (link)`);
      } else {
        const size = await fsp.stat(path.join(directory, name)).then(s => s.size, () => 0);
        lines.push(`${prefix}${name} (${sizeLabel(size)})`);
      }
    }
  }
  await walk(absolute, '', 1);
  const head = `${relative === '.' ? 'Project folder' : relative}${relative.endsWith('/') ? '' : '/'}`;
  const body = lines.length ? lines.join('\n') : '(empty)';
  return {
    text: `${head}\n${body}${cut ? `\n… [more than ${LIMITS.listEntries} entries; list a subfolder]` : ''}`,
    display: { kind: 'list', path: relative, entries: count },
  };
}

/** Reads part of a text file, with line numbers. */
async function readFile(ctx, { path: input, start_line: startLine, end_line: endLine } = {}) {
  if (!input) throw new AgentError('bad_args', 'read_file needs a path.');
  const { absolute, relative } = resolveInside(ctx.rootReal, input);
  if (isSecretPath(relative)) throw new AgentError('secret', `${relative} looks like a secrets file (keys, credentials or .env), so Quo doesn’t read it.`);
  const stat = await fsp.stat(absolute);
  if (stat.isDirectory()) throw new AgentError('not_file', `${relative} is a folder. Use list_directory.`);
  if (stat.size > LIMITS.maxFileBytes) throw new AgentError('too_large', `${relative} is ${sizeLabel(stat.size)}, too large to read. Search inside it instead.`);
  const buffer = await fsp.readFile(absolute);
  if (looksBinary(buffer)) throw new AgentError('binary', `${relative} is a binary file.`);
  const text = buffer.toString('utf8');
  const lines = text.split(/\r?\n/);
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  const start = integer(startLine, 1, 1, Math.max(1, lines.length));
  const end = Math.min(lines.length, integer(endLine, start + LIMITS.readLines - 1, start, start + LIMITS.readLines - 1));
  const width = String(end).length;
  const body = lines.slice(start - 1, end).map((line, index) => `${String(start + index).padStart(width)}\t${clip(line)}`).join('\n');
  ctx.reads.set(absolute, sha(text));
  const more = end < lines.length ? `\n… [${lines.length - end} more lines. Read on with start_line=${end + 1}.]` : '';
  return {
    text: limitOutput(redactSecrets(`${relative} (lines ${start}-${end} of ${lines.length})\n${body}${more}`)),
    display: { kind: 'read', path: relative, from: start, to: end, total: lines.length },
  };
}

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

/** Finds files by name pattern. */
async function findFiles(ctx, { pattern, path: input = '.' } = {}) {
  if (!pattern) throw new AgentError('bad_args', 'find_files needs a pattern, like "**/*.ts".');
  if (String(pattern).length > LIMITS.patternChars) throw new AgentError('bad_args', 'That pattern is too long.');
  const { absolute, relative } = resolveInside(ctx.rootReal, input);
  const matcher = globToRegExp(pattern);
  const found = [];
  let scanned = 0;
  let cut = false;
  for await (const file of walkFiles(ctx.rootReal, absolute)) {
    if (++scanned > LIMITS.searchFiles) {
      cut = true;
      break;
    }
    if (matcher.test(file.relative)) {
      found.push(file.relative);
      if (found.length >= LIMITS.findResults) {
        cut = true;
        break;
      }
    }
  }
  return {
    text: found.length ? `${found.join('\n')}${cut ? `\n… [stopped at ${found.length}; narrow the pattern or folder]` : ''}` : `No files match ${pattern}${relative === '.' ? '' : ` under ${relative}`}.`,
    display: { kind: 'find', pattern, matches: found.length },
  };
}

/**
 * Searches file contents. The pattern is plain text unless `regex` is set; a regex
 * runs in a sandboxed context with a time limit, so a pattern that backtracks
 * forever is cut off instead of freezing the app.
 */
async function searchText(ctx, args = {}) {
  const { pattern, path: input = '.', glob, regex = false, case_sensitive: caseSensitive = false, max_results: maxResults } = args;
  if (!pattern) throw new AgentError('bad_args', 'search_text needs a pattern.');
  if (String(pattern).length > LIMITS.patternChars) throw new AgentError('bad_args', 'That pattern is too long.');
  const { absolute } = resolveInside(ctx.rootReal, input);
  const limit = integer(maxResults, 50, 1, LIMITS.searchResults);
  const globber = glob ? globToRegExp(glob) : null;
  const flags = caseSensitive ? '' : 'i';
  let source = String(pattern);
  if (regex) {
    try {
      new RegExp(source, flags);
    } catch {
      throw new AgentError('bad_pattern', 'That isn’t a valid regular expression.');
    }
  } else source = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const sandbox = vm.createContext({ source, flags, text: '', max: limit });
  const script = new vm.Script(`(() => {
    const re = new RegExp(source, flags);
    const hits = [];
    const lines = text.split(/\\r?\\n/);
    for (let i = 0; i < lines.length && hits.length < max; i++) {
      if (lines[i].length <= 2000 && re.test(lines[i])) hits.push(i);
    }
    return { hits, lines: lines.length };
  })()`);

  const results = [];
  let files = 0;
  let scanned = 0;
  let stopped = null;
  const started = Date.now();
  for await (const file of walkFiles(ctx.rootReal, absolute)) {
    if (globber && !globber.test(file.relative)) continue;
    if (++scanned > LIMITS.searchFiles) {
      stopped = 'too many files';
      break;
    }
    if (Date.now() - started > LIMITS.searchBudgetMs) {
      stopped = 'it took too long';
      break;
    }
    let buffer;
    try {
      const stat = await fsp.stat(file.absolute);
      if (stat.size > LIMITS.maxFileBytes) continue;
      buffer = await fsp.readFile(file.absolute);
    } catch {
      continue;
    }
    if (looksBinary(buffer)) continue;
    const text = buffer.toString('utf8');
    sandbox.text = text;
    let found;
    try {
      found = script.runInContext(sandbox, { timeout: LIMITS.regexBudgetMs });
    } catch (error) {
      if (error?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') throw new AgentError('slow_pattern', 'That pattern is too slow to run. Try a simpler one.');
      throw error;
    }
    if (found.hits.length === 0) continue;
    files++;
    const lines = text.split(/\r?\n/);
    for (const index of found.hits) {
      results.push(`${file.relative}:${index + 1}: ${clip(lines[index].trim(), 300)}`);
      if (results.length >= limit) break;
    }
    if (results.length >= limit) {
      stopped = `reached ${limit} results`;
      break;
    }
  }
  const text = results.length
    ? `${results.join('\n')}${stopped ? `\n… [stopped: ${stopped}. Narrow the search with path or glob.]` : ''}`
    : `No matches for ${pattern}.${stopped ? ` (Stopped: ${stopped}.)` : ''}`;
  return { text: limitOutput(redactSecrets(text)), display: { kind: 'search', pattern, matches: results.length, files } };
}

/** A small unified diff of two texts, with a few lines of context. */
function unifiedDiff(before, after, context = 3) {
  const a = before.split('\n');
  const b = after.split('\n');
  if (a.length * b.length > 4_000_000) {
    return { text: `(${a.length} lines became ${b.length}; too large to show line by line)`, added: Math.max(0, b.length - a.length), removed: Math.max(0, a.length - b.length) };
  }
  // Trim the shared start and end so the table below only covers what changed.
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const x = a.slice(head, a.length - tail);
  const y = b.slice(head, b.length - tail);
  const table = Array.from({ length: x.length + 1 }, () => new Uint32Array(y.length + 1));
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) table[i][j] = x[i] === y[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const ops = [];
  for (let i = 0, j = 0; i < x.length || j < y.length;) {
    if (i < x.length && j < y.length && x[i] === y[j]) {
      ops.push([' ', x[i]]);
      i++;
      j++;
    } else if (i < x.length && (j === y.length || table[i + 1][j] >= table[i][j + 1])) ops.push(['-', x[i++]]);
    else ops.push(['+', y[j++]]);
  }
  const all = [...a.slice(Math.max(0, head - context), head).map(line => [' ', line]), ...ops, ...a.slice(a.length - tail, a.length - tail + context).map(line => [' ', line])];
  let added = 0;
  let removed = 0;
  for (const [mark] of all) {
    if (mark === '+') added++;
    if (mark === '-') removed++;
  }
  // Drop long unchanged stretches inside the diff.
  const out = [];
  let quiet = 0;
  all.forEach(([mark, line], index) => {
    if (mark !== ' ') {
      quiet = 0;
      out.push(`${mark}${line}`);
      return;
    }
    const nearChange = all.slice(Math.max(0, index - context), index + context + 1).some(([m]) => m !== ' ');
    if (nearChange) out.push(` ${line}`);
    else if (++quiet === 1) out.push('…');
  });
  return { text: out.join('\n'), added, removed };
}

async function requireFresh(ctx, absolute, relative, current) {
  const known = ctx.reads.get(absolute);
  if (known === undefined) throw new AgentError('read_first', `Read ${relative} with read_file before changing it.`);
  if (known !== sha(current)) throw new AgentError('changed', `${relative} changed since it was read. Read it again.`);
}

async function loadText(absolute, relative) {
  const stat = await fsp.stat(absolute);
  if (!stat.isFile()) throw new AgentError('not_file', `${relative} isn’t a file.`);
  if (stat.size > LIMITS.maxFileBytes) throw new AgentError('too_large', `${relative} is too large to edit.`);
  const buffer = await fsp.readFile(absolute);
  if (looksBinary(buffer)) throw new AgentError('binary', `${relative} is a binary file.`);
  return buffer.toString('utf8');
}

/** Works out an exact-text replacement without touching the disk. */
async function planEdit(ctx, { path: input, old_string: oldString, new_string: newString, replace_all: replaceAll = false } = {}) {
  if (!input) throw new AgentError('bad_args', 'edit_file needs a path.');
  if (typeof oldString !== 'string' || typeof newString !== 'string') throw new AgentError('bad_args', 'edit_file needs old_string and new_string.');
  if (oldString === '') throw new AgentError('bad_args', 'old_string can’t be empty. To create a file, use write_file.');
  if (oldString === newString) throw new AgentError('no_change', 'old_string and new_string are the same.');
  const { absolute, relative } = resolveInside(ctx.rootReal, input);
  if (isSecretPath(relative)) throw new AgentError('secret', `${relative} looks like a secrets file, so Quo doesn’t change it.`);
  const before = await loadText(absolute, relative);
  await requireFresh(ctx, absolute, relative, before);
  const count = before.split(oldString).length - 1;
  if (count === 0) throw new AgentError('not_found', `old_string wasn’t found in ${relative}. It must match exactly, including whitespace. Read the file again.`);
  if (count > 1 && !replaceAll) throw new AgentError('ambiguous', `old_string appears ${count} times in ${relative}. Include more surrounding lines, or set replace_all.`);
  const after = replaceAll ? before.split(oldString).join(newString) : before.replace(oldString, () => newString);
  if (Buffer.byteLength(after) > LIMITS.maxWriteBytes) throw new AgentError('too_large', 'The result would be too large.');
  const diff = unifiedDiff(before, after);
  return { kind: 'edit', absolute, relative, after, diff: diff.text, added: diff.added, removed: diff.removed, replacements: replaceAll ? count : 1 };
}

/** Works out a whole-file write (a new file, or replacing one that was read) without touching the disk. */
async function planWrite(ctx, { path: input, content } = {}) {
  if (!input) throw new AgentError('bad_args', 'write_file needs a path.');
  if (typeof content !== 'string') throw new AgentError('bad_args', 'write_file needs content.');
  if (Buffer.byteLength(content) > LIMITS.maxWriteBytes) throw new AgentError('too_large', `write_file takes at most ${sizeLabel(LIMITS.maxWriteBytes)}.`);
  const { absolute, relative } = resolveInside(ctx.rootReal, input, { allowMissing: true });
  if (relative === '.') throw new AgentError('bad_path', 'That’s the project folder itself.');
  if (isSecretPath(relative)) throw new AgentError('secret', `${relative} looks like a secrets file, so Quo doesn’t write it.`);
  let before = null;
  try {
    const stat = await fsp.lstat(absolute);
    if (stat.isSymbolicLink()) throw new AgentError('bad_path', `${relative} is a link; Quo doesn’t write through links.`);
    before = await loadText(absolute, relative);
    await requireFresh(ctx, absolute, relative, before);
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
  }
  const diff = unifiedDiff(before ?? '', content);
  return { kind: before === null ? 'create' : 'overwrite', absolute, relative, after: content, diff: diff.text, added: diff.added, removed: diff.removed };
}

/** Writes a plan to disk. Only called after approval. */
async function applyPlan(ctx, plan) {
  await fsp.mkdir(path.dirname(plan.absolute), { recursive: true });
  // The folder was checked when the plan was made; check again that it's still inside the project.
  resolveInside(ctx.rootReal, path.dirname(plan.absolute));
  await fsp.writeFile(plan.absolute, plan.after, { encoding: 'utf8', flag: 'w' });
  ctx.reads.set(plan.absolute, sha(plan.after));
}

module.exports = { LIMITS, listDirectory, readFile, findFiles, searchText, planEdit, planWrite, applyPlan, unifiedDiff, globToRegExp, sha };
