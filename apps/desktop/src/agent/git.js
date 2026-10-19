'use strict';

const { execFile } = require('node:child_process');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { scrubbedEnv } = require('./safety');

/**
 * The branch a project is on and how many files have changed, for the chip in the chat bar. Read-only (`git status`), run
 * by the app itself rather than the model, with the file-system monitor off (a repository's own settings can name a program
 * to run there) and without taking git's optional locks. Null when the folder isn't a repository, or git isn't installed.
 */

const run = (cwd, args) =>
  new Promise(resolve => {
    execFile('git', ['-c', 'core.fsmonitor=false', ...args], { cwd, timeout: 3000, maxBuffer: 1024 * 1024, windowsHide: true, env: { ...scrubbedEnv(), GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' } }, (error, stdout) => resolve(error ? null : stdout));
  });

/** Reads `git status -b --porcelain` output: `## main...origin/main [ahead 1]`, then one line per changed file. */
function parseStatus(output) {
  const [head, ...files] = String(output).split('\n').filter(Boolean);
  if (!head?.startsWith('## ')) return null;
  const name = head.slice(3).replace(/\.\.\..*$/, '').replace(/ \[.*\]$/, '');
  const branch = /^No commits yet on /.test(name) ? name.replace('No commits yet on ', '') : /^HEAD \(no branch\)/.test(name) ? null : name;
  return { branch, changed: files.length };
}

async function gitInfo(root) {
  try {
    await fsp.stat(path.join(root, '.git'));
  } catch {
    return null;
  }
  const output = await run(root, ['status', '-b', '--porcelain=v1']);
  return output === null ? null : parseStatus(output);
}

module.exports = { gitInfo, parseStatus };
