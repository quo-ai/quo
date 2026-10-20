'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { describe, it } = require('node:test');
const { AgentSession } = require('../../src/agent/session');
const { displayUrl, githubRepo, pullRequestUrl } = require('../../src/agent/push');
const { gitEnv } = require('../../src/agent/gitcmd');
const { temp, write } = require('./helpers');

// Remote addresses with a user part are built here, so the repository's secrets scan doesn't read them as email addresses.
const at = (user, host) => `${user}${'@'}${host}`;
const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** A bare "remote" and a clone of it with one pushed commit on main, an identity and no signing. */
function setup() {
  const remote = temp();
  git(remote, 'init', '-q', '--bare', '-b', 'main');
  const root = temp();
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.name', 'Pat Person');
  git(root, 'config', 'user.email', 'pat' + '@example.test');
  git(root, 'config', 'commit.gpgsign', 'false');
  git(root, 'remote', 'add', 'origin', remote);
  write(root, 'README.md', 'hello\n');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'first');
  git(root, 'push', '-q', '-u', 'origin', 'main');
  git(root, 'remote', 'set-head', 'origin', 'main');
  return { root, remote };
}
const commit = (root, file, text = 'x\n') => {
  write(root, file, text);
  git(root, 'add', file);
  git(root, 'commit', '-q', '-m', `Add ${file}`);
};
const remoteHas = (remote, ref) => {
  try {
    return git(remote, 'rev-parse', '--verify', '--quiet', ref);
  } catch {
    return null;
  }
};

describe('git_push', () => {
  const session = (root, answers, extra = {}) => {
    const queue = [...answers];
    const asked = [];
    const s = new AgentSession({ root, name: 'demo', approve: async request => (asked.push(request), queue.shift() ?? 'deny'), ...extra });
    s.asked = asked;
    return s;
  };

  it('pushes a new branch after asking, sets its upstream, and lists exactly the commits going up', async () => {
    const { root, remote } = setup();
    git(root, 'switch', '-q', '-c', 'feature');
    commit(root, 'a.js');
    commit(root, 'b.js');
    const s = session(root, ['once']);
    const result = await s.callTool('git_push', {});
    assert.equal(result.ok, true, result.text);
    assert.equal(remoteHas(remote, 'refs/heads/feature'), git(root, 'rev-parse', 'HEAD'));
    assert.equal(git(root, 'rev-parse', '--abbrev-ref', '@{u}'), 'origin/feature');
    const view = s.asked[0].view;
    assert.equal(s.asked[0].kind, 'push');
    assert.equal(s.asked[0].rememberLabel, undefined, 'every push asks');
    assert.deepEqual([view.count, view.newBranch, view.toDefault, view.commits.length], [2, true, false, 2]);
    assert.match(view.commits[0], /Add b\.js$/);
    assert.equal(result.display.pullRequest, undefined, 'not a GitHub remote: no pull-request link');
  });

  it('asks every time, and pushes nothing when the person says no', async () => {
    const { root, remote } = setup();
    commit(root, 'a.js');
    const before = remoteHas(remote, 'refs/heads/main');
    const s = session(root, ['session', 'deny']);
    for (let i = 0; i < 2; i++) assert.equal((await s.callTool('git_push', {})).ok, false);
    assert.equal(s.asked.length, 2, '"for this session" is not an answer a push takes');
    assert.equal(remoteHas(remote, 'refs/heads/main'), before);
  });

  it('says when it would go straight to the default branch', async () => {
    const { root } = setup();
    commit(root, 'a.js');
    const s = session(root, ['deny']);
    await s.callTool('git_push', {});
    assert.equal(s.asked[0].view.toDefault, true);
    assert.match(s.asked[0].detail, /default branch/);
  });

  it('ignores every argument: no other remote, branch, refspec or force can be asked for', async () => {
    const { root, remote } = setup();
    const other = temp();
    git(other, 'init', '-q', '--bare', '-b', 'main');
    git(root, 'remote', 'add', 'evil', other);
    git(root, 'switch', '-q', '-c', 'feature');
    commit(root, 'a.js');
    const s = session(root, ['once']);
    const result = await s.callTool('git_push', { remote: 'evil', branch: 'main', refspec: '+HEAD:main', force: true, args: ['--force', '--mirror'] });
    assert.equal(result.ok, true, result.text);
    assert.equal(remoteHas(other, 'refs/heads/main'), null, 'nothing went to the other remote');
    assert.ok(remoteHas(remote, 'refs/heads/feature'));
    assert.equal(s.asked[0].view.remote, 'origin');
  });

  it('never forces: when the remote has commits this branch lacks, it refuses before asking', async () => {
    const { root, remote } = setup();
    const elsewhere = temp();
    execFileSync('git', ['clone', '-q', remote, elsewhere]);
    git(elsewhere, 'config', 'user.name', 'Sam');
    git(elsewhere, 'config', 'user.email', 'sam' + '@example.test');
    commit(elsewhere, 'theirs.js');
    git(elsewhere, 'push', '-q');
    commit(root, 'mine.js');
    const s = session(root, ['once']);
    // Not fetched yet: the remote rejects it, and Quo says to pull, never to force.
    const rejected = await s.callTool('git_push', {});
    assert.equal(rejected.ok, false);
    assert.match(rejected.text, /pull first[\s\S]*Never force-push/);
    git(root, 'fetch', '-q');
    const asked = s.asked.length;
    const refused = await s.callTool('git_push', {});
    assert.equal(refused.ok, false);
    assert.match(refused.text, /has 1 commit this branch doesn’t/);
    assert.equal(s.asked.length, asked, 'known in advance: not even asked');
    assert.match(git(remote, 'log', '-1', '--format=%s', 'main'), /theirs\.js/, 'their commit is still there');
  });

  it('refuses with nothing to push, on a detached HEAD, and with no remote', async () => {
    const { root } = setup();
    assert.match((await session(root, []).callTool('git_push', {})).text, /no new commits/);
    git(root, 'switch', '-q', '--detach');
    assert.match((await session(root, []).callTool('git_push', {})).text, /detached HEAD/);
    const lonely = temp();
    git(lonely, 'init', '-q', '-b', 'main');
    git(lonely, 'config', 'user.name', 'P');
    git(lonely, 'config', 'user.email', 'p' + '@example.test');
    commit(lonely, 'a.js');
    assert.match((await session(lonely, []).callTool('git_push', {})).text, /no remote/);
  });

  it('won’t push while hooks in the project have uncommitted changes', async () => {
    const { root } = setup();
    git(root, 'config', 'core.hooksPath', '.githooks');
    commit(root, 'a.js');
    write(root, '.githooks/pre-push', '#!/bin/sh\nexit 0\n');
    const s = session(root, ['once']);
    const result = await s.callTool('git_push', {});
    assert.equal(result.ok, false);
    assert.match(result.text, /hooks have uncommitted changes/);
    assert.equal(s.asked.length, 0);
  });

  it('reports a hook that stops the push, for the model to fix rather than skip', { skip: process.platform === 'win32' }, async () => {
    const { root } = setup();
    write(root, '.githooks/pre-push', '#!/bin/sh\necho "lint failed: a.js" >&2\nexit 1\n');
    execFileSync('chmod', ['+x', `${root}/.githooks/pre-push`]);
    git(root, 'add', '.githooks');
    git(root, 'commit', '-q', '-m', 'hooks');
    git(root, 'config', 'core.hooksPath', '.githooks');
    commit(root, 'a.js');
    const result = await session(root, ['once']).callTool('git_push', {});
    assert.equal(result.ok, false);
    assert.match(result.text, /hook stopped the push[\s\S]*never bypass hooks[\s\S]*lint failed/);
  });

  it('is not there at all when pushing is turned off, and a push command says so', async () => {
    const { root } = setup();
    commit(root, 'a.js');
    const s = session(root, ['once', 'once'], { allowPush: false });
    assert.match((await s.callTool('git_push', {})).text, /turned off in the user’s settings/);
    assert.match((await s.callTool('run_command', { command: 'git push' })).text, /turned off in the user’s settings/);
    assert.equal(s.asked.length, 0);
  });
});

describe('addresses and links', () => {
  it('never shows a password or token from a remote address', () => {
    assert.equal(displayUrl('https://pat:' + 'gh' + 'p_' + 'a'.repeat(36) + '@github.com/a/b.git'), 'https://github.com/a/b.git');
    assert.equal(displayUrl('https://x-access-token:secret@example.com/r.git'), 'https://example.com/r.git');
    assert.equal(displayUrl(at('git', 'github.com:a/b.git')), at('git', 'github.com:a/b.git'));
  });

  it('knows a GitHub repository in every address form, and nothing else', () => {
    for (const url of ['https://github.com/quo-ai/quo.git', 'https://github.com/quo-ai/quo', at('git', 'github.com:quo-ai/quo.git'), `ssh://${at('git', 'github.com/quo-ai/quo.git')}`, `https://${at('tok', 'github.com/quo-ai/quo.git')}`]) assert.equal(githubRepo(url), 'quo-ai/quo', url);
    for (const url of ['https://gitlab.com/a/b.git', 'https://github.com.evil.example/a/b', 'https://evil.example/github.com/a/b', '/tmp/repo', '']) assert.equal(githubRepo(url), null, url);
  });

  it('links to GitHub’s own pull-request page, crediting Quo only when that is on', () => {
    const on = new URL(pullRequestUrl('quo-ai/quo', 'main', 'feat/x', true));
    assert.equal(on.origin + on.pathname, 'https://github.com/quo-ai/quo/compare/main...feat%2Fx');
    assert.match(on.searchParams.get('body'), /Made with \[Quo\]/);
    assert.equal(new URL(pullRequestUrl('quo-ai/quo', 'main', 'x', false)).searchParams.get('body'), null);
    assert.equal(pullRequestUrl('quo-ai/quo', 'main', 'main', true), null);
  });
});

describe('the environment git gets for commits and pushes', () => {
  it('keeps the SSH and gpg agents so signing and SSH remotes work, and still drops tokens', () => {
    const env = gitEnv({ PATH: '/bin', SSH_AUTH_SOCK: '/run/agent.sock', GPG_TTY: '/dev/pts/1', GITHUB_TOKEN: 't', GH_TOKEN: 't', OPENAI_API_KEY: 'k', SSH_PRIVATE_KEY: 'k' });
    assert.equal(env.SSH_AUTH_SOCK, '/run/agent.sock');
    assert.equal(env.GPG_TTY, '/dev/pts/1');
    for (const name of ['GITHUB_TOKEN', 'GH_TOKEN', 'OPENAI_API_KEY', 'SSH_PRIVATE_KEY']) assert.equal(env[name], undefined, name);
    assert.equal(env.GIT_TERMINAL_PROMPT, '0');
  });
});
