'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * Finds the person's own `claude` program. Quo runs only the copy they installed and signed in to: it never ships or
 * downloads Claude Code, and the page can't name a program. QUO_CLAUDE_PATH, set by the person in their own
 * environment, picks another copy.
 */

function isExecutable(file) {
  try {
    if (!fs.statSync(file).isFile()) return false;
    if (process.platform !== 'win32') fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Where to look, in order: the PATH, then where Claude Code's installers put it (apps started from the desktop often don't get the shell's PATH). */
function searchDirs({ env, platform, home }) {
  const separator = platform === 'win32' ? ';' : ':';
  const dirs = String(env.PATH ?? env.Path ?? '').split(separator);
  if (home) dirs.push(path.join(home, '.local', 'bin'), path.join(home, '.claude', 'local'), path.join(home, '.npm-global', 'bin'), path.join(home, '.bun', 'bin'));
  if (platform === 'darwin') dirs.push('/opt/homebrew/bin', '/usr/local/bin');
  if (platform === 'linux') dirs.push('/usr/local/bin', '/usr/bin');
  // A relative entry ("." or "bin") would find a program in whatever folder Quo happens to be in.
  return [...new Set(dirs.filter(dir => dir && path.isAbsolute(dir)))];
}

function findClaude({ env = process.env, platform = process.platform, home = os.homedir(), executable = isExecutable } = {}) {
  const chosen = env.QUO_CLAUDE_PATH;
  if (chosen) return path.isAbsolute(chosen) && executable(chosen) ? chosen : null;
  const name = platform === 'win32' ? 'claude.exe' : 'claude';
  for (const dir of searchDirs({ env, platform, home })) {
    const file = path.join(dir, name);
    if (executable(file)) return file;
  }
  return null;
}

module.exports = { findClaude };
