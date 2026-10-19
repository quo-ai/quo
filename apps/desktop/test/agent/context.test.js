'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const { describe, it } = require('node:test');
const { score, suggestFiles } = require('../../src/agent/files/fuzzy');
const { gitInfo, parseStatus } = require('../../src/agent/git');
const { whereIs } = require('../../src/agent/location');
const { AgentSession } = require('../../src/agent/session');
const { ctxFor, temp, write } = require('./helpers');

const hasGit = (() => { try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

describe('where a project is', () => {
  it('shows the last few folders, with the home folder as ~, and never more', () => {
    assert.equal(whereIs(path.join(os.homedir(), 'code', 'app')), '~/code/app');
    assert.equal(whereIs(path.join(os.homedir(), 'a', 'b', 'c', 'app')), '…/b/c/app');
    if (process.platform !== 'win32') assert.equal(whereIs('/srv/www/site'), '/srv/www/site');
  });
});

describe('the branch a project is on', () => {
  it('reads git status', () => {
    assert.deepEqual(parseStatus('## main...origin/main [ahead 1]\n M a.js\n?? b.js\n'), { branch: 'main', changed: 2 });
    assert.deepEqual(parseStatus('## feature/x\n'), { branch: 'feature/x', changed: 0 });
    assert.deepEqual(parseStatus('## HEAD (no branch)\n M a.js\n'), { branch: null, changed: 1 });
    assert.deepEqual(parseStatus('## No commits yet on main\n?? a.js\n'), { branch: 'main', changed: 1 });
    assert.equal(parseStatus('fatal: not a git repository'), null);
    assert.equal(parseStatus(''), null);
  });

  it('is null for a folder that isn’t a repository, and finds the branch and changes in one that is', { skip: !hasGit }, async () => {
    const plain = temp();
    assert.equal(await gitInfo(plain), null);
    const repo = temp();
    const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
    git('init', '-q', '-b', 'trunk');
    write(repo, 'a.txt', 'one');
    assert.deepEqual(await gitInfo(repo), { branch: 'trunk', changed: 1 });
    git('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'add', '.');
    git('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '-m', 'x');
    assert.deepEqual(await gitInfo(repo), { branch: 'trunk', changed: 0 });
  });
});

describe('finding a file by part of its name', () => {
  it('puts the closest matches first', () => {
    assert.ok(score('src/app.js', 'app.js') < score('src/app.jsx', 'app.js'));
    assert.ok(score('src/app.js', 'app') < score('src/mapper.js', 'app'));
    assert.ok(score('src/mapper.js', 'app') < score('app/main.js', 'main') + 5);
    assert.ok(score('lib/utils/format.js', 'utils') < score('lib/utils/format.js', 'lufj'));
    assert.equal(score('src/app.js', 'zzz'), null);
    assert.ok(score('a.js', '') < score('a/b/c.js', ''));
  });

  it('searches the project, skipping dependencies and secrets, and caps the list', async () => {
    const root = temp();
    for (const file of ['src/app.js', 'src/util/app-helper.js', 'README.md', 'node_modules/app/index.js', '.env', 'docs/appendix.md']) write(root, file, 'x');
    for (let i = 0; i < 30; i++) write(root, `many/file${i}.txt`, 'x');
    const found = await suggestFiles(ctxFor(root), 'app');
    assert.equal(found[0], 'src/app.js');
    assert.ok(found.includes('src/util/app-helper.js') && found.includes('docs/appendix.md'));
    assert.ok(!found.some(file => file.includes('node_modules') || file.includes('.env')));
    assert.equal((await suggestFiles(ctxFor(root), 'file', { limit: 5 })).length, 5);
    assert.equal((await suggestFiles(ctxFor(root), '')).length, 12);
    assert.deepEqual(await suggestFiles(ctxFor(root), 'nothing-like-this'), []);
  });

  it('is offered by a session, for its own project only', async () => {
    const root = temp();
    write(root, 'src/main.js', 'x');
    const session = new AgentSession({ root, name: 'demo', approve: async () => 'deny' });
    assert.deepEqual(await session.suggestFiles('main'), ['src/main.js']);
  });
});
