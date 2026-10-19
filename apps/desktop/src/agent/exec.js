'use strict';

const { spawn } = require('node:child_process');

/**
 * Runs one shell command the user has approved: in the project folder, with a
 * scrubbed environment, no input, a time limit, and its output capped. When the
 * time is up (or the user stops the turn) the whole process tree is killed.
 */

const HEAD_CHARS = 10_000;
const TAIL_CHARS = 20_000;

function killTree(child) {
  if (!child.pid) return;
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else process.kill(-child.pid, 'SIGKILL');
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      // Already gone.
    }
  }
}

function runCommand({ command, cwd, env, timeoutMs = 120_000, signal, headChars = HEAD_CHARS, tailChars = TAIL_CHARS }) {
  return new Promise(resolve => {
    // On Windows, cmd.exe looks in the project folder before anywhere else; this stops a `git.bat` there from replacing git.
    const safeEnv = process.platform === 'win32' ? { ...env, NoDefaultCurrentDirectoryInExePath: '1' } : env;
    const child = spawn(command, { shell: true, cwd, env: safeEnv, detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let head = '';
    let tail = '';
    let total = 0;
    let timedOut = false;
    let aborted = false;

    const take = chunk => {
      const text = chunk.toString('utf8');
      total += text.length;
      if (head.length < headChars) {
        const room = headChars - head.length;
        head += text.slice(0, room);
        tail += text.slice(room);
      } else tail += text;
      if (tail.length > tailChars * 2) tail = tail.slice(-tailChars);
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);
    const onAbort = () => {
      aborted = true;
      killTree(child);
    };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });

    const finish = (exitCode, exitSignal) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      const kept = head.length + Math.min(tail.length, tailChars);
      const output = total <= headChars + tailChars
        ? head + tail
        : `${head}\n… [${(total - kept).toLocaleString('en-US')} characters cut] …\n${tail.slice(-tailChars)}`;
      resolve({ exitCode, signal: exitSignal, timedOut, aborted, output });
    };
    child.on('error', error => {
      head += `Couldn’t start the command: ${error.message}`;
      finish(null, null);
    });
    child.on('close', finish);
  });
}

module.exports = { runCommand, killTree };
