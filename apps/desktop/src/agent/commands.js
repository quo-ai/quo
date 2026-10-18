'use strict';

const { isSecretPath } = require('./safety');

/**
 * Which commands may run without asking: a short list of ones that only look.
 * Everything else, and anything this isn't sure about, goes to the user.
 *
 * The rule is "recognise, don't filter": a command qualifies only if every character is
 * plain (no quotes, pipes, redirects, substitutions or line breaks, so nothing can be
 * chained or expanded), it names one of a few programs, and its arguments are ones that
 * can't write a file, read outside the project or open a secrets file. Reading files has
 * its own tools, so `cat` and friends are deliberately not on the list.
 *
 * Not on Windows: cmd.exe looks for programs in the project folder before anywhere
 * else, so a `git.bat` in a cloned project would run instead of git.
 */

const PLAIN = /^[A-Za-z0-9 _@%+=:,./^~-]+$/;
const MAX_LENGTH = 300;

// `git` can run for free when it only reads the history and the working tree.
const GIT_READING = new Set(['status', 'log', 'diff', 'show', 'ls-files', 'rev-parse', 'blame', 'describe']);
// Options that write a file, run a configured program, compare files outside the repository, or read a side file.
const GIT_REFUSED = /^(--output|--ext-diff|--textconv|--no-index|--open-files-in-pager|--orderfile|-O)/;

// `<tool> --version`. Not yarn, pnpm, cargo, rustc or go: they pick a version from the project's own files and may
// download it or run it.
const VERSION_TOOLS = new Set(['node', 'npm', 'npx', 'python', 'python3', 'pip', 'pip3', 'java', 'ruby', 'php', 'gcc', 'g++', 'clang', 'make', 'cmake', 'deno', 'bun', 'git']);
const VERSION_FLAGS = new Set(['--version', '-v', '-V', '-version']);

const outsideProject = value => value.startsWith('/') || value.startsWith('~') || /(^|\/)\.\.(\/|$)/.test(value);

/** True for a path-like argument that could reach outside the project or a secrets file. */
function risky(token) {
  // A token can carry a path after "=" (--opt=path) or ":" (HEAD:path).
  const candidates = [token, token.split('=').pop(), token.split(':').pop()].filter(Boolean);
  return candidates.some(value => (!value.startsWith('-') && outsideProject(value)) || isSecretPath(value.replace(/^-+/, '')));
}

/** Whether `command` may run without asking the user. */
function isReadOnlyCommand(command, platform = process.platform) {
  if (platform === 'win32') return false;
  const text = String(command ?? '').trim();
  if (!text || text.length > MAX_LENGTH || !PLAIN.test(text)) return false;
  const [program, ...args] = text.split(/ +/);

  if (VERSION_TOOLS.has(program) && args.length === 1 && VERSION_FLAGS.has(args[0])) return true;
  if (program !== 'git' || !GIT_READING.has(args[0])) return false;
  return args.slice(1).every(token => !GIT_REFUSED.test(token) && !risky(token));
}

/** Takes the parts of a `git diff` or `git show` that belong to secrets files out of its output. */
function hideSecretDiffs(output) {
  const lines = output.split('\n');
  const kept = [];
  let hiding = false;
  for (const line of lines) {
    const header = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (header) {
      hiding = isSecretPath(header[1]) || isSecretPath(header[2]);
      if (hiding) {
        kept.push(`[changes to ${header[2]} left out: it looks like a secrets file]`);
        continue;
      }
    }
    if (!hiding) kept.push(line);
  }
  return kept.join('\n');
}

module.exports = { isReadOnlyCommand, hideSecretDiffs };
