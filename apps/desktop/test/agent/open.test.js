'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const { AgentSession } = require('../../src/agent/session');
const { planOpen } = require('../../src/agent/open');
const { temp, write, trySymlink } = require('./helpers');

const ctxFor = root => ({ rootReal: root, reads: new Map() });

describe('what may be opened in a browser', () => {
  it('is a page, image or document in the project, as a file address', () => {
    const root = temp();
    write(root, 'index.html', '<h1>hi</h1>');
    write(root, 'docs/a.pdf', '%PDF');
    write(root, 'img/logo.PNG', 'x');
    const plan = planOpen(ctxFor(root), 'index.html');
    assert.equal(plan.what, 'file');
    assert.equal(plan.target, 'index.html');
    assert.match(plan.url, /^file:\/\/.*index\.html$/);
    assert.equal(planOpen(ctxFor(root), 'docs/a.pdf').target, 'docs/a.pdf');
    assert.equal(planOpen(ctxFor(root), 'img/logo.PNG').what, 'file');
    assert.equal(planOpen(ctxFor(root), path.join(root, 'index.html')).target, 'index.html', 'an absolute path inside the project is fine');
  });

  it('is an address on this computer, nothing else', () => {
    const root = temp();
    for (const ok of ['http://localhost:5173', 'http://127.0.0.1:3000/app?x=1', 'https://localhost/', 'http://[::1]:8080/']) assert.equal(planOpen(ctxFor(root), ok).what, 'url', ok);
    for (const bad of ['https://example.com', 'http://localhost.evil.com', 'http://127.0.0.1.evil.com/', 'http://user:pw@localhost:3000/', 'javascript:alert(1)', 'file:///etc/passwd', 'ftp://localhost/', 'data:text/html,<script>1</script>', 'http://0.0.0.0:3000', 'http://192.168.1.5:3000', 'vscode://open', 'ssh://localhost']) {
      assert.throws(() => planOpen(ctxFor(root), bad), error => ['bad_url', 'bad_args'].includes(error.code), bad);
    }
  });

  it('is never something the system would run', () => {
    const root = temp();
    for (const name of ['run.sh', 'tool.exe', 'start.bat', 'a.desktop', 'x.jar', 'page.html.exe', 'script.js', 'Makefile', 'link.lnk', 'a.command', 'notes.md', 'noextension']) {
      write(root, name, 'x');
      assert.throws(() => planOpen(ctxFor(root), name), error => error.code === 'bad_type', name);
    }
  });

  it('is never a secrets file, a folder, a missing file, or something outside the project', () => {
    const root = temp();
    const outside = temp();
    write(root, '.env.html', '<p>');
    write(root, '.ssh/page.html', '<p>');
    write(root, 'dir.html/x', 'x');
    write(outside, 'evil.html', '<script>1</script>');
    for (const bad of ['.env.html', '.ssh/page.html', 'dir.html', 'nope.html', '../evil.html', path.join(outside, 'evil.html'), '']) assert.throws(() => planOpen(ctxFor(root), bad), error => ['secret', 'not_file', 'not_found', 'outside_project', 'bad_args'].includes(error.code), bad);
    if (trySymlink(path.join(outside, 'evil.html'), path.join(root, 'link.html'))) assert.throws(() => planOpen(ctxFor(root), 'link.html'), error => error.code === 'outside_project');
  });
});

describe('the agent opening a page', () => {
  const make = (answers, root = temp()) => {
    const queue = [...answers];
    const asked = [];
    const opened = [];
    const s = new AgentSession({ root, name: 'demo', approve: async request => (asked.push(request), queue.shift() ?? 'deny'), openExternal: async url => opened.push(url) });
    return Object.assign(s, { asked, opened, root });
  };

  it('asks first, shows what and where, and opens only after a yes', async () => {
    const s = make(['once']);
    write(s.root, 'index.html', '<h1>hi</h1>');
    const result = await s.callTool('open_in_browser', { target: 'index.html' });
    assert.equal(result.ok, true, result.text);
    assert.equal(s.asked.length, 1);
    assert.equal(s.asked[0].kind, 'open');
    assert.deepEqual(s.asked[0].view, { kind: 'open', what: 'file', target: 'index.html' });
    assert.equal(s.opened.length, 1);
    assert.match(s.opened[0], /^file:\/\//);
  });

  it('opens nothing when the person says no, and tells the agent not to ask again', async () => {
    const s = make(['deny']);
    write(s.root, 'index.html', '<h1>hi</h1>');
    const result = await s.callTool('open_in_browser', { target: 'index.html' });
    assert.equal(result.ok, false);
    assert.equal(result.display.denied, true);
    assert.deepEqual(s.opened, []);
    assert.match(result.text, /tell them where it is/);
  });

  it('remembers a yes for the session, for files and local servers alike', async () => {
    const s = make(['session']);
    write(s.root, 'a.html', '<p>');
    write(s.root, 'b.html', '<p>');
    await s.callTool('open_in_browser', { target: 'a.html' });
    await s.callTool('open_in_browser', { target: 'b.html' });
    await s.callTool('open_in_browser', { target: 'http://localhost:5173' });
    assert.equal(s.asked.length, 1);
    assert.equal(s.opened.length, 3);
  });

  it('refuses before asking when the target is not allowed, and in plan mode', async () => {
    const s = make(['once', 'once']);
    write(s.root, 'run.sh', 'x');
    write(s.root, 'a.html', '<p>');
    assert.equal((await s.callTool('open_in_browser', { target: 'run.sh' })).ok, false);
    assert.equal((await s.callTool('open_in_browser', { target: 'https://example.com' })).ok, false);
    assert.equal(s.asked.length, 0);
    s.setMode('plan');
    assert.equal((await s.callTool('open_in_browser', { target: 'a.html' })).ok, false);
    assert.equal(s.asked.length, 0);
    assert.deepEqual(s.opened, []);
  });

  it('cannot open anything where the app supplied no way to', async () => {
    const s = new AgentSession({ root: temp(), name: 'demo', approve: async () => 'once' });
    assert.equal((await s.callTool('open_in_browser', { target: 'http://localhost:3000' })).ok, false);
  });
});
