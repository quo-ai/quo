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

/** Works out an exact-text replacement without touching the disk. */
async function planEdit(ctx, { path: input, old_string: oldString, new_string: newString, replace_all: replaceAll = false } = {}) {
  if (!input) throw new AgentError('bad_args', 'edit_file needs a path.');
  if (typeof oldString !== 'string' || typeof newString !== 'string') throw new AgentError('bad_args', 'edit_file needs old_string and new_string.');
  if (oldString === '') throw new AgentError('bad_args', 'old_string can’t be empty. To create a file, use write_file.');
  if (oldString === newString) throw new AgentError('no_change', 'old_string and new_string are the same.');
  const { absolute, relative } = resolveInside(ctx.rootReal, input);
  if (isSecretPath(relative)) throw new AgentError('secret', `${relative} looks like a secrets file, so Quo doesn’t change it.`);
  refuseProtected(relative);
  const before = await loadText(absolute, relative);
  await requireFresh(ctx, absolute, relative, before);
  const count = before.split(oldString).length - 1;
  if (count === 0) throw new AgentError('not_found', `old_string wasn’t found in ${relative}. It must match exactly, including whitespace. Read the file again.`);
  if (count > 1 && !replaceAll) throw new AgentError('ambiguous', `old_string appears ${count} times in ${relative}. Include more surrounding lines, or set replace_all.`);
  const after = replaceAll ? before.split(oldString).join(newString) : before.replace(oldString, () => newString);
  if (Buffer.byteLength(after) > LIMITS.maxWriteBytes) throw new AgentError('too_large', 'The result would be too large.');
  const diff = unifiedDiff(before, after);
  return { kind: 'edit', absolute, relative, before, after, diff: diff.text, added: diff.added, removed: diff.removed, replacements: replaceAll ? count : 1 };
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
