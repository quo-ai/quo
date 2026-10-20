'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { AgentError, resolveInside, isSecretPath, isProtectedPath, inside, redactSecrets } = require('./safety');
const { git } = require('./gitcmd');

/**
 * The git_commit tool: one commit, made by the app itself with fixed arguments, never by a command the model wrote.
 *
 * The person stays the author. When "Credit Quo in commits" is on, the app adds one `Co-Authored-By` line at the end of
 * the message (the model never writes it, so it can't be left out, changed or pointed at someone else). It is only text
 * in the person's own repository; nothing is sent anywhere, and nothing here pushes (git_push, push.js, is its own tool
 * with its own approval).
 *
 * The address is the noreply email of `quo-code`, the GitHub user account that stands for Quo (an ordinary user, as
 * Claude's `claude` is, so GitHub shows "quo-code" with Quo's picture and no "[bot]"). The number is that account's id;
 * change it only together with the account.
 */

const QUO_CREDIT = 'Co-Authored-By: Quo <345051252+quo-code@users.noreply.github.com>';
const MAX_FILES = 50;
const MAX_MESSAGE = 4000;

/** The message the model wrote, tidied, without any credit line of ours (the app adds that), or a refusal. */
function cleanMessage(input) {
  if (typeof input !== 'string') throw new AgentError('bad_args', 'git_commit needs a message.');
  const message = input.replace(/\r\n?/g, '\n').replace(/\0/g, '').trim();
  if (!message) throw new AgentError('bad_args', 'git_commit needs a message.');
  if (message.length > MAX_MESSAGE) throw new AgentError('bad_args', 'That commit message is too long.');
  if (redactSecrets(message) !== message) throw new AgentError('secret', 'That message contains something that looks like a secret. Write it again without it.');
  // The credit is the app's to add: drop any copy the model wrote, and any lookalike aimed at the same address.
  const kept = message.split('\n').filter(line => !/^\s*co-authored-by:.*(quo-ai(\[bot\])?|quo-code)|^\s*co-authored-by:\s*quo\b/i.test(line));
  return kept.join('\n').trim();
}

/** The whole message as it will be committed. */
const fullMessage = (message, credit) => (credit ? `${message}\n\n${QUO_CREDIT}` : message);

/** Changed files as `git status` sees them (relative paths, forward slashes). */
function parseStatus(output) {
  const parts = output.split('\0').filter(Boolean);
  const changed = new Set();
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (entry.length < 4) continue;
    changed.add(entry.slice(3));
    if (entry[0] === 'R' || entry[0] === 'C' || entry[1] === 'R' || entry[1] === 'C') i++; // the old name follows
  }
  return changed;
}

/**
 * Works out what a commit would be and checks every rule, without changing anything. Throws AgentError to refuse.
 * Returns what the dialog shows and what `apply` needs.
 */
async function planCommit({ rootReal, env = process.env, credit = true }, args) {
  const message = cleanMessage(args.message);
  if (!Array.isArray(args.files) || args.files.length === 0) throw new AgentError('bad_args', 'git_commit needs files: the paths to commit, relative to the project.');
  if (args.files.length > MAX_FILES) throw new AgentError('bad_args', `Commit at most ${MAX_FILES} files at a time.`);

  if (!fs.existsSync(path.join(rootReal, '.git'))) throw new AgentError('no_repo', 'This project folder isn’t a git repository.');
  const name = (await git(rootReal, ['config', 'user.name'], env)).stdout.trim();
  const email = (await git(rootReal, ['config', 'user.email'], env)).stdout.trim();
  if (!name || !email) throw new AgentError('no_identity', 'Git has no name or email set for this project, so there is no one to commit as. Ask the user to set user.name and user.email; do not set them yourself.');

  const status = await git(rootReal, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], env);
  if (status.code !== 0) throw new AgentError('git_failed', 'Git couldn’t read the project’s status.');
  const changed = parseStatus(status.stdout);

  const files = [];
  for (const raw of args.files) {
    if (typeof raw !== 'string') throw new AgentError('bad_args', 'Each file must be a path.');
    const { relative } = resolveInside(rootReal, raw, { allowMissing: true });
    if (isSecretPath(relative)) throw new AgentError('secret', `${relative} looks like a secrets file and is never committed.`);
    if (isProtectedPath(relative)) throw new AgentError('protected', `${relative} is a settings file that can run commands, so Quo doesn’t commit it. The user can commit it themselves.`);
    if (!changed.has(relative)) throw new AgentError('not_changed', `${relative} has no changes to commit.`);
    if (!files.includes(relative)) files.push(relative);
  }

  await checkHooks(rootReal, env, changed, 'commit');

  const branch = (await git(rootReal, ['rev-parse', '--abbrev-ref', 'HEAD'], env)).stdout.trim() || 'HEAD';
  return { message, files, credit, text: fullMessage(message, credit), author: `${name} <${email}>`, branch };
}

/** A hooks folder inside the project that has uncommitted edits could run code nobody looked at: refuse while it does. */
async function checkHooks(rootReal, env, changed, verb) {
  const hooks = (await git(rootReal, ['config', 'core.hooksPath'], env)).stdout.trim();
  if (!hooks) return;
  const folder = path.resolve(rootReal, hooks);
  const relative = path.relative(rootReal, folder);
  if (inside(relative) && [...changed].some(file => path.resolve(rootReal, file).startsWith(folder + path.sep))) {
    throw new AgentError('hooks_changed', `The project’s git hooks have uncommitted changes, so Quo won’t ${verb} while they could run. The user should review and commit those first.`);
  }
}

/** Whether the repository has an executable hook of this name (git doesn't say a hook stopped it; it prints the hook's words). */
async function hasHook(rootReal, env, name) {
  const where = (await git(rootReal, ['rev-parse', '--git-path', `hooks/${name}`], env)).stdout.trim();
  if (!where) return false;
  try {
    fs.accessSync(path.resolve(rootReal, where), fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Stages exactly the planned files and commits exactly those, nothing else that happened to be staged. */
async function applyCommit({ rootReal, env = process.env }, plan) {
  const add = await git(rootReal, ['add', '--', ...plan.files], env);
  if (add.code !== 0) throw new AgentError('git_failed', `git add failed: ${redactSecrets(add.stderr.trim()).slice(0, 400)}`);
  const commit = await git(rootReal, ['commit', '--only', '-m', plan.text, '--', ...plan.files], env);
  if (commit.code !== 0) {
    const said = redactSecrets(`${commit.stderr}\n${commit.stdout}`.trim()).slice(0, 1500);
    const hooked = (await hasHook(rootReal, env, 'pre-commit')) || (await hasHook(rootReal, env, 'commit-msg'));
    if (hooked && !/nothing (added )?to commit|no changes added/i.test(said)) throw new AgentError('hook_failed', `A git hook stopped the commit, so nothing was committed. Fix what it reports, then call git_commit again (a new commit; never bypass hooks):\n${said}`);
    throw new AgentError('git_failed', `git commit failed: ${said.slice(0, 600)}`);
  }
  const hash = (await git(rootReal, ['rev-parse', '--short', 'HEAD'], env)).stdout.trim();
  return { hash };
}

module.exports = { planCommit, applyCommit, cleanMessage, fullMessage, checkHooks, hasHook, parseStatus, QUO_CREDIT };
