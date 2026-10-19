'use strict';

const { spawn } = require('node:child_process');
const { killTree } = require('./exec');
const { AgentError, redactSecrets, scrubbedEnv } = require('./safety');

/**
 * Commands that keep running while the agent works (a dev server, a watcher, a long build), started only after the
 * person approved the exact command, like any other. They run in the project folder with the same scrubbed environment,
 * no input and a time limit, at most three at once. The agent can read what they printed since it last looked and stop
 * them; nothing else about them is its to control. Every one is killed, with its whole process tree, when the Code
 * session ends or the app quits.
 */

const MAX_RUNNING = 3;
const KEEP_CHARS = 100_000; // the newest output kept per command
const LIFETIME_MS = 60 * 60 * 1000;
const MAX_WAIT_S = 30;
const READ_CHARS = 8000;

class BackgroundCommands {
  constructor({ cwd, env }) {
    this.cwd = cwd;
    this.env = env;
    this.jobs = new Map();
    this.next = 1;
  }

  get running() {
    return [...this.jobs.values()].filter(job => job.status === 'running').length;
  }

  /** Throws when there is no room, so the person isn't asked about something that can't start. */
  assertRoom() {
    if (this.running >= MAX_RUNNING) throw new AgentError('too_many', `${MAX_RUNNING} background commands are already running. Stop one with stop_command first.`);
  }

  start(command) {
    this.assertRoom();
    const id = `bg${this.next++}`;
    const safeEnv = process.platform === 'win32' ? { ...scrubbedEnv(this.env), NoDefaultCurrentDirectoryInExePath: '1' } : scrubbedEnv(this.env);
    const child = spawn(command, { shell: true, cwd: this.cwd, env: safeEnv, detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const job = { id, command, child, status: 'running', exitCode: null, buffer: '', dropped: 0, total: 0, read: 0, waiters: new Set(), stoppedByUs: false };
    const wake = () => {
      for (const waiter of job.waiters) waiter();
    };
    const take = chunk => {
      const text = chunk.toString('utf8');
      job.total += text.length;
      job.buffer += text;
      if (job.buffer.length > KEEP_CHARS) {
        job.dropped += job.buffer.length - KEEP_CHARS;
        job.buffer = job.buffer.slice(-KEEP_CHARS);
      }
      wake();
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    job.timer = setTimeout(() => this.stop(id), LIFETIME_MS);
    job.timer.unref?.();
    child.on('error', error => {
      take(`Couldn’t start the command: ${error.message}`);
      job.status = 'exited';
      clearTimeout(job.timer);
      wake();
    });
    child.on('close', code => {
      clearTimeout(job.timer);
      job.exitCode = code;
      job.status = job.stoppedByUs ? 'stopped' : 'exited';
      wake();
    });
    this.jobs.set(id, job);
    return { id, pid: child.pid };
  }

  get(id) {
    const job = this.jobs.get(String(id ?? ''));
    if (!job) throw new AgentError('no_command', `There is no background command ${id}. ${this.jobs.size ? `Started so far: ${[...this.jobs.keys()].join(', ')}.` : 'None have been started.'}`);
    return job;
  }

  /** What the command printed since the last look, and whether it is still running. Waits up to `waitSeconds` for news. */
  async output(id, waitSeconds, signal) {
    const job = this.get(id);
    const wait = Math.min(MAX_WAIT_S, Math.max(0, Number(waitSeconds) || 0)) * 1000;
    if (wait > 0 && job.status === 'running' && job.total === job.read && !signal?.aborted) {
      await new Promise(resolve => {
        const done = () => {
          clearTimeout(timer);
          job.waiters.delete(done);
          signal?.removeEventListener('abort', done);
          resolve();
        };
        const timer = setTimeout(done, wait);
        job.waiters.add(done);
        signal?.addEventListener('abort', done, { once: true });
      });
    }
    const lost = Math.max(0, job.dropped - job.read);
    const from = Math.max(job.read, job.dropped);
    let text = job.buffer.slice(from - job.dropped);
    job.read = job.total;
    let cut = 0;
    if (text.length > READ_CHARS) {
      cut = text.length - READ_CHARS;
      text = text.slice(-READ_CHARS);
    }
    const notes = [lost + cut > 0 ? `[${(lost + cut).toLocaleString('en-US')} earlier characters left out]` : '', text.trimEnd() || '(no new output)'].filter(Boolean).join('\n');
    const state = job.status === 'running' ? 'still running' : job.status === 'stopped' ? 'stopped' : `exited with code ${job.exitCode}`;
    return { text: redactSecrets(`$ ${job.command}  [${job.id}: ${state}]\n${notes}`), running: job.status === 'running', command: job.command, id: job.id, exitCode: job.exitCode, state };
  }

  stop(id) {
    const job = this.get(id);
    if (job.status !== 'running') return { id: job.id, command: job.command, already: true };
    job.stoppedByUs = true;
    killTree(job.child);
    return { id: job.id, command: job.command, already: false };
  }

  /** Ends everything still running: the Code session is over. */
  close() {
    for (const job of this.jobs.values()) {
      if (job.status === 'running') {
        job.stoppedByUs = true;
        killTree(job.child);
      }
      clearTimeout(job.timer);
    }
  }
}

module.exports = { BackgroundCommands, MAX_RUNNING };
