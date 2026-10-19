'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const { AgentError, isProtectedPath, isSecretPath, looksBinary, resolveInside } = require('../safety');
const { unifiedDiff } = require('./diff');
const { LIMITS, sha, sizeLabel } = require('./limits');


function refuseProtected(relative) {
  if (isProtectedPath(relative)) {
    throw new AgentError('protected', `${relative} holds settings that can run commands on their own (editor tasks, git hooks, agent configs), so Quo doesn’t change it. Ask the user to edit it themselves.`);
  }
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

const MAX_EDITS = 20;

/** Where the first line of `text` best matches a line of the file, ignoring indentation: a hint for a miss. */
function closestLine(before, text) {
  const first = text.split('\n').map(line => line.trim()).find(Boolean);
  if (!first || first.length < 4) return null;
  const lines = before.split('\n');
  const index = lines.findIndex(line => line.trim() === first) >= 0 ? lines.findIndex(line => line.trim() === first) : lines.findIndex(line => line.includes(first));
  return index >= 0 ? index + 1 : null;
}

/** The same text with the file's own line endings, so an edit written with \n still matches a CRLF file. */
const withEndings = (text, crlf) => (crlf ? text.replace(/\r?\n/g, '\r\n') : text);

/** Applies one replacement to `text`, or throws what went wrong (named by `where` when there are several). */
function applyOne(text, relative, edit, where) {
  const { old_string: oldString, new_string: newString, replace_all: replaceAll = false } = edit ?? {};
  if (typeof oldString !== 'string' || typeof newString !== 'string') throw new AgentError('bad_args', `${where}edit_file needs old_string and new_string.`);
  if (oldString === '') throw new AgentError('bad_args', `${where}old_string can’t be empty. To create a file, use write_file.`);
  if (oldString === newString) throw new AgentError('no_change', `${where}old_string and new_string are the same.`);
  const crlf = text.includes('\r\n');
  const find = text.includes(oldString) ? oldString : withEndings(oldString, crlf);
  const replacement = find === oldString ? newString : withEndings(newString, crlf);
  const count = text.split(find).length - 1;
  if (count === 0) {
    const line = closestLine(text, oldString);
    const hint = line ? ` The nearest match to its first line is at line ${line}: read that part again and copy it exactly.` : ' Read the file again.';
    throw new AgentError('not_found', `${where}old_string wasn’t found in ${relative}. It must match exactly, including whitespace.${hint}`);
  }
  if (count > 1 && !replaceAll) throw new AgentError('ambiguous', `${where}old_string appears ${count} times in ${relative}. Include more surrounding lines, or set replace_all.`);
  return { text: replaceAll ? text.split(find).join(replacement) : text.replace(find, () => replacement), count: replaceAll ? count : 1 };
}

/**
 * Works out an exact-text replacement without touching the disk. Either one (old_string, new_string) or `edits`, a list
 * applied in order to the same file and approved as one change: if any of them fails, none is made.
 */
async function planEdit(ctx, { path: input, old_string: oldString, new_string: newString, replace_all: replaceAll = false, edits } = {}) {
  if (!input) throw new AgentError('bad_args', 'edit_file needs a path.');
  let list;
  if (edits !== undefined) {
    if (!Array.isArray(edits) || edits.length === 0 || edits.length > MAX_EDITS) throw new AgentError('bad_args', `edits must be a list of 1 to ${MAX_EDITS} replacements.`);
    list = edits;
  } else {
    if (typeof oldString !== 'string' || typeof newString !== 'string') throw new AgentError('bad_args', 'edit_file needs old_string and new_string.');
    list = [{ old_string: oldString, new_string: newString, replace_all: replaceAll }];
  }
  const { absolute, relative } = resolveInside(ctx.rootReal, input);
  if (isSecretPath(relative)) throw new AgentError('secret', `${relative} looks like a secrets file, so Quo doesn’t change it.`);
  refuseProtected(relative);
  const before = await loadText(absolute, relative);
  await requireFresh(ctx, absolute, relative, before);
  let after = before;
  let replacements = 0;
  list.forEach((edit, index) => {
    const result = applyOne(after, relative, edit, list.length > 1 ? `Edit ${index + 1} of ${list.length}: ` : '');
    after = result.text;
    replacements += result.count;
  });
  if (after === before) throw new AgentError('no_change', 'Those edits leave the file as it was.');
  if (Buffer.byteLength(after) > LIMITS.maxWriteBytes) throw new AgentError('too_large', 'The result would be too large.');
  const diff = unifiedDiff(before, after);
  return { kind: 'edit', absolute, relative, before, after, diff: diff.text, added: diff.added, removed: diff.removed, replacements };
}

/** Works out a whole-file write (a new file, or replacing one that was read) without touching the disk. */
async function planWrite(ctx, { path: input, content } = {}) {
  if (!input) throw new AgentError('bad_args', 'write_file needs a path.');
  if (typeof content !== 'string') throw new AgentError('bad_args', 'write_file needs content.');
  if (Buffer.byteLength(content) > LIMITS.maxWriteBytes) throw new AgentError('too_large', `write_file takes at most ${sizeLabel(LIMITS.maxWriteBytes)}.`);
  const { absolute, relative } = resolveInside(ctx.rootReal, input, { allowMissing: true });
  if (relative === '.') throw new AgentError('bad_path', 'That’s the project folder itself.');
  if (isSecretPath(relative)) throw new AgentError('secret', `${relative} looks like a secrets file, so Quo doesn’t write it.`);
  refuseProtected(relative);
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
  return { kind: before === null ? 'create' : 'overwrite', absolute, relative, before, after: content, diff: diff.text, added: diff.added, removed: diff.removed };
}

/** Writes a plan to disk. Only called after approval. */
async function applyPlan(ctx, plan) {
  await fsp.mkdir(path.dirname(plan.absolute), { recursive: true });
  // The folder was checked when the plan was made; check again that it's still inside the project.
  resolveInside(ctx.rootReal, path.dirname(plan.absolute));
  await fsp.writeFile(plan.absolute, plan.after, { encoding: 'utf8', flag: 'w' });
  ctx.reads.set(plan.absolute, sha(plan.after));
}

module.exports = { planEdit, planWrite, applyPlan };
