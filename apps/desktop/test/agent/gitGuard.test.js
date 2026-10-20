'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { checkGitCommand, gitCalls } = require('../../src/agent/gitGuard');
const { AgentSession } = require('../../src/agent/session');
const { temp } = require('./helpers');

const refusal = (command, options) => {
  try {
    checkGitCommand(command, options);
    return null;
  } catch (error) {
    return error.code;
  }
};

describe('git commands the model writes', () => {
  it('sends commits and pushes to their tools, however the command is dressed up', () => {
    for (const command of ['git commit -m x', 'git commit -am "x"', 'cd src && git commit -m x', 'GIT_AUTHOR_NAME=x git commit -m y', 'git -C . -c user.name=x commit -m y', '/usr/bin/git commit -m x', 'npm test; git commit -m x', 'sudo git commit']) assert.equal(refusal(command), 'use_tool', command);
    for (const command of ['git push', 'git push origin main', 'git -C .. push', 'npm test && git push -u origin feature']) assert.equal(refusal(command), 'use_tool', command);
  });

  it('refuses force pushes, deleting remote branches, amending and skipping hooks outright', () => {
    for (const command of ['git push --force', 'git push -f origin main', 'git push --force-with-lease', 'git push origin +main', 'git push origin :old', 'git push --delete origin x', 'git push --mirror', 'git push --prune origin']) assert.equal(refusal(command), 'force_push', command);
    assert.equal(refusal('git commit --amend --no-edit'), 'use_tool');
    for (const command of ['git commit --no-verify -m x', 'git commit -n -m x', 'git push --no-verify', 'git merge --no-verify topic']) assert.equal(refusal(command), 'no_verify', command);
  });

  it('says pushing is off when it is, instead of pointing at a tool that isn’t there', () => {
    assert.equal(refusal('git push', { allowPush: false }), 'push_off');
    assert.equal(refusal('git push --force', { allowPush: false }), 'force_push');
  });

  it('leaves other git commands, and the word git elsewhere, alone', () => {
    for (const command of ['git status', 'git log --oneline', 'git commit-tree HEAD^{tree}', 'echo "git commit"', 'grep -r "git push" docs', 'git switch -c feature', 'git merge topic', 'git fetch', 'git pull --rebase', 'npm run commit']) assert.equal(refusal(command), null, command);
  });

  it('warns about commands that throw work away, for the approval window', () => {
    assert.match(checkGitCommand('git reset --hard HEAD~1'), /reset --hard/);
    assert.match(checkGitCommand('git clean -fd'), /untracked files/);
    assert.match(checkGitCommand('git checkout -- src/a.js'), /uncommitted changes/);
    assert.match(checkGitCommand('git restore .'), /uncommitted changes/);
    assert.match(checkGitCommand('git branch -D old'), /branch -D/);
    assert.match(checkGitCommand('git stash drop'), /stashed/);
    assert.match(checkGitCommand('git rebase -i HEAD~3'), /Rewrites history/);
    assert.equal(checkGitCommand('git reset HEAD a.js'), '');
    assert.equal(checkGitCommand('npm test'), '');
  });

  it('finds each git call in a line', () => {
    assert.deepEqual(gitCalls('cd x && git -C y status --short; git log -1'), [{ sub: 'status', args: ['--short'] }, { sub: 'log', args: ['-1'] }]);
  });
});

describe('in a session', () => {
  it('refuses before the approval window opens, and shows the warning when it does', async () => {
    const asked = [];
    const s = new AgentSession({ root: temp(), name: 'demo', approve: async request => (asked.push(request), 'deny') });
    const commit = await s.callTool('run_command', { command: 'git commit -am wip' });
    assert.equal(commit.ok, false);
    assert.match(commit.text, /git_commit tool/);
    assert.equal(asked.length, 0);
    await s.callTool('run_command', { command: 'git reset --hard' });
    assert.match(asked[0].view.warning, /reset --hard/);
    assert.match(asked[0].detail, /⚠ Throws away/);
  });
});
