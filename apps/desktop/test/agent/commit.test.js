'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { describe, it } = require('node:test');
const { AgentSession } = require('../../src/agent/session');
const { QUO_CREDIT, cleanMessage } = require('../../src/agent/commit');
const { temp, write } = require('./helpers');

const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

/** A real repository with one commit, an identity, and a hooks-free configuration. */
function repo({ identity = true } = {}) {
  const root = temp();
  git(root, 'init', '-q', '-b', 'main');
  if (identity) {
    git(root, 'config', 'user.name', 'Pat Person');
    git(root, 'config', 'user.email', 'pat' + '@example.test');
  }
  git(root, 'config', 'commit.gpgsign', 'false');
  write(root, 'README.md', 'hello\n');
  git(root, 'add', '.');
  if (identity) git(root, 'commit', '-q', '-m', 'first');
  return root;
}

describe('git_commit', () => {
  const asked = [];
  const session = (root, answers, extra = {}) => {
    const queue = [...answers];
    return new AgentSession({ root, name: 'demo', approve: async request => (asked.push(request), queue.shift() ?? 'deny'), ...extra });
  };
  const messageOf = root => git(root, 'log', '-1', '--format=%B');

  it('commits the listed files, as the person, with the credit as the last line', async () => {
    const root = repo();
    write(root, 'a.js', 'a\n');
    write(root, 'b.js', 'b\n');
    const result = await session(root, ['once']).callTool('git_commit', { message: 'Add a', files: ['a.js'] });
    assert.equal(result.ok, true, result.text);
    assert.equal(messageOf(root), `Add a\n\n${QUO_CREDIT}`);
    assert.equal(git(root, 'log', '-1', '--format=%an <%ae>'), 'Pat Person <pat' + '@example.test>');
    assert.equal(git(root, 'log', '-1', '--format=%cn'), 'Pat Person');
    assert.equal(git(root, 'status', '--porcelain'), '?? b.js', 'only the listed file was committed');
    assert.match(asked.at(-1).detail, /Co-Authored-By: Quo <344842314\+quo-ai\[bot\]@users\.noreply\.github\.com>/);
  });

  it('adds no credit when the setting is off', async () => {
    const root = repo();
    write(root, 'a.js', 'a\n');
    const result = await session(root, ['once'], { creditQuo: false }).callTool('git_commit', { message: 'Add a', files: ['a.js'] });
    assert.equal(result.ok, true);
    assert.equal(messageOf(root), 'Add a');
    assert.doesNotMatch(asked.at(-1).detail, /Co-Authored-By/);
  });

  it('commits only what was listed, even when other files are already staged', async () => {
    const root = repo();
    write(root, 'a.js', 'a\n');
    write(root, 'staged.js', 's\n');
    git(root, 'add', 'staged.js');
    assert.equal((await session(root, ['once']).callTool('git_commit', { message: 'Add a', files: ['a.js'] })).ok, true);
    assert.equal(git(root, 'show', '--name-only', '--format=', 'HEAD'), 'a.js');
    assert.equal(git(root, 'status', '--porcelain'), 'A  staged.js');
  });

  it('writes the credit itself: a copy or lookalike from the model is dropped, not doubled', async () => {
    assert.equal(cleanMessage(`Fix\n\n${QUO_CREDIT}`), 'Fix');
    assert.equal(cleanMessage('Fix\n\nCo-authored-by: Quo <x+quo-ai[bot]' + '@users.noreply.github.com>'), 'Fix');
    assert.equal(cleanMessage('Fix\n\nCo-Authored-By: Quo <someone' + '@else.test>'), 'Fix');
    const root = repo();
    write(root, 'a.js', 'a\n');
    await session(root, ['once']).callTool('git_commit', { message: `Fix\n\n${QUO_CREDIT}`, files: ['a.js'] });
    assert.equal(messageOf(root).split('Co-Authored-By').length, 2);
  });

  it('shows the person every commit and does nothing if they say no', async () => {
    const root = repo();
    write(root, 'a.js', 'a\n');
    const s = session(root, ['deny']);
    const result = await s.callTool('git_commit', { message: 'Add a', files: ['a.js'] });
    assert.equal(result.ok, false);
    assert.equal(result.display.denied, true);
    assert.equal(git(root, 'log', '--format=%s'), 'first');
    // "for this session" is not a thing for commits: a second commit asks again.
    const again = session(root, ['session', 'deny']);
    await again.callTool('git_commit', { message: 'Add a', files: ['a.js'] });
    const before = asked.length;
    await again.callTool('git_commit', { message: 'Add a again', files: ['a.js'] });
    assert.equal(asked.length, before + 1);
    assert.equal(git(root, 'log', '--format=%s'), 'first');
  });

  it('is off in plan mode', async () => {
    const root = repo();
    write(root, 'a.js', 'a\n');
    const s = session(root, ['once']);
    s.setMode('plan');
    assert.equal((await s.callTool('git_commit', { message: 'x', files: ['a.js'] })).ok, false);
    assert.equal(git(root, 'log', '--format=%s'), 'first');
  });

  it('never commits secrets, settings that can run commands, or paths outside the project', async () => {
    const root = repo();
    write(root, '.env', 'A=1\n');
    write(root, '.vscode/tasks.json', '{}\n');
    write(root, 'id_rsa', 'k\n');
    write(root, 'ok.js', 'x\n');
    const s = session(root, ['once', 'once', 'once', 'once', 'once', 'once']);
    for (const file of ['.env', '.vscode/tasks.json', 'id_rsa', '../outside.txt', '/etc/passwd']) {
      const result = await s.callTool('git_commit', { message: 'x', files: ['ok.js', file] });
      assert.equal(result.ok, false, file);
    }
    assert.equal(git(root, 'log', '--format=%s'), 'first');
  });

  it('does not read file names as patterns or git options', async () => {
    const root = repo();
    write(root, 'a.js', 'a\n');
    write(root, 'b.js', 'b\n');
    for (const file of ['*.js', ':(top)a.js', '--all', '.', 'missing.js']) {
      assert.equal((await session(root, ['once']).callTool('git_commit', { message: 'x', files: [file] })).ok, false, file);
    }
    assert.equal(git(root, 'log', '--format=%s'), 'first');
  });

  it('refuses secrets in the message, empty messages and no files', async () => {
    const root = repo();
    write(root, 'a.js', 'a\n');
    const token = `gh${'p_'}${'a'.repeat(36)}`;
    for (const args of [{ message: `token ${token}`, files: ['a.js'] }, { message: '  ', files: ['a.js'] }, { message: 'x', files: [] }, { message: 'x' }, { files: ['a.js'] }]) {
      assert.equal((await session(root, ['once']).callTool('git_commit', args)).ok, false, JSON.stringify(args));
    }
  });

  it('will not invent who is committing, and does not touch git settings', async () => {
    const root = repo({ identity: false });
    write(root, 'a.js', 'a\n');
    // No global identity either, whoever's machine this runs on.
    const env = { ...process.env, GIT_CONFIG_GLOBAL: path.join(root, 'none'), GIT_CONFIG_NOSYSTEM: '1', HOME: root };
    const result = await session(root, ['once'], { env }).callTool('git_commit', { message: 'x', files: ['a.js'] });
    assert.equal(result.ok, false);
    assert.match(result.text, /name or email/);
    assert.doesNotMatch(require('node:fs').readFileSync(path.join(root, '.git', 'config'), 'utf8'), /\[user\]/);
  });

  it('is not run for a folder that is not a repository', async () => {
    const root = temp();
    write(root, 'a.js', 'a\n');
    assert.equal((await session(root, ['once']).callTool('git_commit', { message: 'x', files: ['a.js'] })).ok, false);
  });

  it('will not commit while the project’s own git hooks have uncommitted edits', async () => {
    const root = repo();
    write(root, 'hooks/pre-commit', '#!/bin/sh\necho hi\n');
    git(root, 'config', 'core.hooksPath', 'hooks');
    write(root, 'a.js', 'a\n');
    const result = await session(root, ['once']).callTool('git_commit', { message: 'x', files: ['a.js'] });
    assert.equal(result.ok, false);
    assert.match(result.text, /hooks/);
  });

  it('never pushes', async () => {
    const root = repo();
    const remote = temp();
    git(remote, 'init', '-q', '--bare');
    git(root, 'remote', 'add', 'origin', remote);
    write(root, 'a.js', 'a\n');
    await session(root, ['once']).callTool('git_commit', { message: 'x', files: ['a.js'] });
    assert.equal(git(remote, 'for-each-ref'), '');
    assert.ok(path.isAbsolute(remote));
  });
});
