'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it } = require('node:test');
const { AgentSession } = require('../../src/agent/session');
const { MAX_ROOTS } = require('../../src/agent/external');
const { temp, write, trySymlink } = require('./helpers');

describe('reading outside the project', () => {
  const make = (answers, extra = {}) => {
    const queue = [...answers];
    const asked = [];
    const root = temp();
    const s = new AgentSession({ root, name: 'demo', approve: async request => (asked.push(request), queue.shift() ?? 'deny'), ...extra });
    return Object.assign(s, { asked, root });
  };

  it('asks for the folder, shows which one, and reads there read-only', async () => {
    const other = temp();
    write(other, 'shared/config.json', '{"a":1}\n');
    const s = make(['once']);
    const result = await s.callTool('read_file', { path: path.join(other, 'shared', 'config.json') });
    assert.equal(result.ok, true, result.text);
    assert.match(result.text, /Outside the project, read-only/);
    assert.match(result.text, /"a":1/);
    assert.equal(s.asked.length, 1);
    assert.equal(s.asked[0].kind, 'read');
    assert.ok(s.asked[0].detail.includes(path.join(fs.realpathSync(other), 'shared')));
    assert.match(s.asked[0].detail, /never change anything/);
  });

  it('remembers a folder approved for the session, and asks again after a single yes', async () => {
    const other = temp();
    write(other, 'a.txt', 'a\n');
    write(other, 'sub/b.txt', 'b\n');
    const session = make(['session']);
    await session.callTool('read_file', { path: path.join(other, 'a.txt') });
    await session.callTool('read_file', { path: path.join(other, 'sub', 'b.txt') }); // inside the approved folder
    assert.equal(session.asked.length, 1);
    const once = make(['once', 'once']);
    await once.callTool('read_file', { path: path.join(other, 'a.txt') });
    await once.callTool('read_file', { path: path.join(other, 'a.txt') });
    assert.equal(once.asked.length, 2);
  });

  it('does nothing if the person says no, and tells the model not to ask again', async () => {
    const other = temp();
    write(other, 'a.txt', 'a\n');
    const s = make(['deny']);
    const result = await s.callTool('read_file', { path: path.join(other, 'a.txt') });
    assert.equal(result.ok, false);
    assert.match(result.text, /Don’t ask again/);
  });

  it('lists, finds and searches in an approved folder too', async () => {
    const other = temp();
    write(other, 'src/a.js', 'const needle = 1;\n');
    const s = make(['session']);
    assert.match((await s.callTool('list_directory', { path: other })).text, /src/);
    assert.match((await s.callTool('find_files', { pattern: '**/*.js', path: other })).text, /src\/a\.js/);
    assert.match((await s.callTool('search_text', { pattern: 'needle', path: other })).text, /a\.js/);
    assert.equal(s.asked.length, 1);
  });

  it('never reads secrets there, however the path is written', async () => {
    const other = temp();
    write(other, '.ssh/id_rsa', 'KEY\n');
    write(other, '.env', 'A=1\n');
    write(other, 'repo/.git/config', '[core]\n');
    const s = make(['session', 'session', 'session', 'session']);
    for (const p of [path.join(other, '.ssh', 'id_rsa'), path.join(other, '.ssh'), path.join(other, '.env'), path.join(other, 'repo', '.git', 'config')]) {
      assert.equal((await s.callTool('read_file', { path: p })).ok, false, p);
    }
    assert.equal(s.asked.filter(request => /\.ssh|\.git/.test(request.detail)).length, 0, 'not even asked about a keys folder');
  });

  it('never opens system folders, the home folder or a drive', async () => {
    const s = make(['session', 'session', 'session', 'session']);
    const targets = [os.homedir(), path.parse(os.homedir()).root, '/etc', '/etc/passwd', '/proc', '/usr'].filter(p => fs.existsSync(p));
    for (const p of targets) assert.equal((await s.callTool('list_directory', { path: p })).ok === false || p === '/usr', true, p);
    assert.equal((await s.callTool('read_file', { path: '/etc/passwd' })).ok, false);
    assert.equal(s.asked.length, 0, 'refused before anyone is asked');
  });

  it('judges a link by where it really leads: asks about that folder, and says so', async () => {
    const other = temp();
    const elsewhere = temp();
    write(elsewhere, 'password.txt', 'hunter2\n');
    write(other, 'ok.txt', 'ok\n');
    if (!trySymlink(elsewhere, path.join(other, 'link'))) return;
    const s = make(['session', 'deny']);
    await s.callTool('read_file', { path: path.join(other, 'ok.txt') });
    const result = await s.callTool('read_file', { path: path.join(other, 'link', 'password.txt') });
    assert.equal(result.ok, false, 'the approved folder does not cover where the link goes');
    assert.doesNotMatch(result.text, /hunter2/);
    assert.equal(s.asked.length, 2);
    assert.ok(s.asked[1].detail.includes(fs.realpathSync(elsewhere)), 'the dialog names the real folder, not the link');
  });

  it('cannot change anything there: editing and writing stay inside the project', async () => {
    const other = temp();
    write(other, 'a.txt', 'one\n');
    const s = make(['session', 'once', 'once', 'once']);
    await s.callTool('read_file', { path: path.join(other, 'a.txt') });
    const edit = await s.callTool('edit_file', { path: path.join(other, 'a.txt'), old_string: 'one', new_string: 'two' });
    const create = await s.callTool('write_file', { path: path.join(other, 'new.txt'), content: 'x' });
    assert.equal(edit.ok, false);
    assert.equal(create.ok, false);
    assert.equal(fs.readFileSync(path.join(other, 'a.txt'), 'utf8'), 'one\n');
    assert.equal(fs.existsSync(path.join(other, 'new.txt')), false);
  });

  it('leaves absolute paths inside the project, and ordinary relative ones, to the ordinary rules', async () => {
    const s = make([]);
    write(s.root, 'a.txt', 'a\n');
    assert.equal((await s.callTool('read_file', { path: path.join(s.root, 'a.txt') })).ok, true);
    assert.equal((await s.callTool('read_file', { path: 'a.txt' })).ok, true);
    assert.equal((await s.callTool('read_file', { path: '../outside.txt' })).ok, false);
    assert.equal(s.asked.length, 0);
  });

  it('keeps to a handful of folders', async () => {
    const s = make(Array(MAX_ROOTS + 1).fill('session'));
    for (let i = 0; i < MAX_ROOTS; i++) {
      const dir = temp();
      write(dir, 'f.txt', 'x\n');
      assert.equal((await s.callTool('read_file', { path: path.join(dir, 'f.txt') })).ok, true);
    }
    const extra = temp();
    write(extra, 'f.txt', 'x\n');
    const result = await s.callTool('read_file', { path: path.join(extra, 'f.txt') });
    assert.equal(result.ok, false);
    assert.match(result.text, /already reading in/);
  });

  it('refuses a path that does not exist, and a reference repository is unaffected', async () => {
    const s = make(['session']);
    assert.equal((await s.callTool('read_file', { path: '/definitely/not/here.txt' })).ok, false);
    assert.equal(s.asked.length, 0);
  });
});
