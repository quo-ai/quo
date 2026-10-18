'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { hideSecretDiffs, isReadOnlyCommand } = require('../../src/agent/commands');
const { AgentSession } = require('../../src/agent/session');
const { temp, write } = require('./helpers');

const posix = command => isReadOnlyCommand(command, 'linux');

describe('commands that run without asking', () => {
  it('lets through git that only reads, and version checks', () => {
    for (const command of ['git status', 'git status --short --branch', 'git log --oneline -n 5', 'git diff', 'git diff --stat HEAD~1', 'git diff main..feature -- src/app.js',
      'git show HEAD', 'git show HEAD:src/app.js', 'git ls-files', 'git rev-parse --show-toplevel', 'git blame -L10,20 src/app.js', 'git describe --tags',
      'node --version', 'npm -v', 'python3 --version', 'java -version', 'git --version', 'make -v']) {
      assert.equal(posix(command), true, command);
    }
  });

  it('asks about everything else', () => {
    for (const command of ['npm test', 'npm install', 'node app.js', 'rm -rf build', 'cat package.json', 'ls', 'curl https://example.com', 'git commit -m x', 'git push',
      'git checkout main', 'git reset --hard', 'git clean -fd', 'git stash', 'git config --list', 'git remote -v', 'git branch -D x', 'git -c core.pager=sh status',
      'yarn --version', 'pnpm --version', 'cargo --version', 'node --version extra', 'npm --version --foo', '', '   ']) {
      assert.equal(posix(command), false, command);
    }
  });

  it('asks when anything could be chained, redirected, substituted or expanded', () => {
    for (const command of ['git status; rm -rf x', 'git status && rm x', 'git status | sh', 'git status > out.txt', 'git log `id`', 'git log $(id)', 'git log ${HOME}', 'git status\nrm x',
      'git "status"', "git 'status'", 'git status #', 'git status &', 'git log --format=%h*', 'git log ~/x', 'git status\tx', 'git diff (a)', 'node\r--version', 'git log \\x']) {
      assert.equal(posix(command), false, JSON.stringify(command));
    }
  });

  it('asks when git could write a file, run a program, or reach outside the project', () => {
    for (const command of ['git diff --output=out.txt', 'git log --output out.txt', 'git diff --ext-diff', 'git show --textconv HEAD:a', 'git diff --no-index a b', 'git diff /etc/hostname /dev/null',
      'git diff ../other/a ../other/b', 'git log -- ../x', 'git show HEAD:../x', 'git diff -Oorder.txt', 'git diff --orderfile=order.txt', 'git diff ~/a ~/b', 'git blame /etc/passwd']) {
      assert.equal(posix(command), false, command);
    }
  });

  it('asks when a secrets file is named, however it is named', () => {
    for (const command of ['git diff -- .env', 'git show HEAD:.env', 'git blame .env.local', 'git log -p -- config/id_rsa', 'git show HEAD:keys/server.pem', 'git diff --stat -- .ssh/config', 'git show --format=x HEAD:.npmrc']) {
      assert.equal(posix(command), false, command);
    }
    assert.equal(posix('git diff -- .env.example'), true);
  });

  it('never runs on its own on Windows, where the project folder is searched for programs first', () => {
    assert.equal(isReadOnlyCommand('git status', 'win32'), false);
    assert.equal(isReadOnlyCommand('node --version', 'win32'), false);
  });

  it('takes the parts of a diff that belong to secrets out of the output', () => {
    const output = ['diff --git a/src/app.js b/src/app.js', '+console.log(1)', 'diff --git a/.env b/.env', '+TOKEN=abc123', 'diff --git a/config/id_rsa b/config/id_rsa', '+key', 'diff --git a/README.md b/README.md', '+hello'].join('\n');
    const cleaned = hideSecretDiffs(output);
    assert.ok(cleaned.includes('+console.log(1)') && cleaned.includes('+hello'));
    assert.ok(!cleaned.includes('abc123') && !cleaned.includes('+key'));
    assert.match(cleaned, /changes to \.env left out/);
    assert.equal(hideSecretDiffs('plain text'), 'plain text');
  });
});

describe('a session and read-only commands', { skip: process.platform === 'win32' }, () => {
  const session = (root, answers = []) => {
    const approvals = [];
    const queue = [...answers];
    const made = new AgentSession({ root, name: 'demo', approve: async request => (approvals.push(request), queue.shift() ?? 'deny') });
    return { made, approvals };
  };

  it('runs one without a dialog, and says so', async () => {
    const { made, approvals } = session(temp());
    const result = await made.callTool('run_command', { command: 'node --version' });
    assert.equal(result.ok, true);
    assert.match(result.text, /v\d+/);
    assert.equal(result.display.auto, true);
    assert.equal(approvals.length, 0);
  });

  it('asks for every command when the setting is off', async () => {
    const approvals = [];
    const made = new AgentSession({ root: temp(), name: 'demo', autoReadOnly: false, approve: async request => (approvals.push(request), 'once') });
    const result = await made.callTool('run_command', { command: 'node --version' });
    assert.equal(result.ok, true);
    assert.equal(result.display.auto, undefined);
    assert.equal(approvals.length, 1);
  });

  it('still asks for any other command, and for a read-only one that could be a trick', async () => {
    const root = temp();
    write(root, 'a.txt', 'x');
    const { made, approvals } = session(root, ['deny', 'deny']);
    assert.equal((await made.callTool('run_command', { command: 'node -e "1"' })).ok, false);
    assert.equal((await made.callTool('run_command', { command: 'git status; node --version' })).ok, false);
    assert.equal(approvals.length, 2);
  });
});
