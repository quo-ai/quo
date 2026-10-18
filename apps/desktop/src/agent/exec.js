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

function runCommand({ command, cwd, env, timeoutMs = 120_000, signal }) {
  return new Promise(resolve => {
    const child = spawn(command, { shell: true, cwd, env, detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let head = '';
    let tail = '';
    let total = 0;
    let timedOut = false;
    let aborted = false;

    const take = chunk => {
      const text = chunk.toString('utf8');
      total += text.length;
      if (head.length < HEAD_CHARS) {
        const room = HEAD_CHARS - head.length;
        head += text.slice(0, room);
        tail += text.slice(room);
      } else tail += text;
      if (tail.length > TAIL_CHARS * 2) tail = tail.slice(-TAIL_CHARS);
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
      const kept = head.length + Math.min(tail.length, TAIL_CHARS);
      const output = total <= HEAD_CHARS + TAIL_CHARS
        ? head + tail
        : `${head}\n… [${(total - kept).toLocaleString('en-US')} characters cut] …\n${tail.slice(-TAIL_CHARS)}`;
      resolve({ exitCode, signal: exitSignal, timedOut, aborted, output });
    };
    child.on('error', error => {
      head += `Couldn’t start the command: ${error.message}`;
      finish(null, null);
    });
    child.on('close', finish);
  });
}

module.exports = { runCommand };
