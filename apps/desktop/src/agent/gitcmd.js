'use strict';

const { execFile } = require('node:child_process');
const { scrubbedEnv } = require('./safety');

/**
 * Git as the app itself runs it for git_commit and git_push: fixed arguments the app chose, never a command the model
 * wrote. The environment is the scrubbed one commands get, plus the agents that sign commits and reach the remote
 * (an SSH agent's socket, gpg's), so signed commits and SSH remotes work as they do for the person. Those sockets are
 * not secrets in themselves, and model-written commands never get them. Git never prompts: a sign-in it can't do
 * on its own fails and says why.
 */

const SIGNING_AGENTS = ['SSH_AUTH_SOCK', 'GPG_AGENT_INFO', 'GPG_TTY', 'GNUPGHOME'];
const TIMEOUT_MS = 60_000;

function gitEnv(env = process.env) {
  const kept = scrubbedEnv(env);
  for (const name of SIGNING_AGENTS) if (typeof env[name] === 'string' && env[name]) kept[name] = env[name];
  return { ...kept, GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true' };
}

const git = (cwd, args, env, { timeoutMs = TIMEOUT_MS } = {}) =>
  new Promise(resolve => {
    execFile('git', ['--literal-pathspecs', '-c', 'core.fsmonitor=false', ...args], { cwd, timeout: timeoutMs, maxBuffer: 1024 * 1024, windowsHide: true, env: gitEnv(env) }, (error, stdout, stderr) =>
      resolve({ code: error ? (typeof error.code === 'number' ? error.code : -1) : 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') }),
    );
  });

module.exports = { git, gitEnv, SIGNING_AGENTS };
