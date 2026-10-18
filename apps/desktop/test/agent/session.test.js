'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const { AgentSession } = require('../../src/agent/session');
const { temp, write, node, trySymlink } = require('./helpers');

describe('a session', () => {
  const approvals = [];
  const session = (root, answers, extra = {}) => {
    const queue = [...answers];
    return new AgentSession({
      root,
      name: 'demo',
      approve: async request => {
        approvals.push(request);
        return queue.shift() ?? 'deny';
      },
      ...extra,
    });
  };

  it('reads freely, without asking anyone', async () => {
    const root = temp();
    write(root, 'a.txt', 'hello');
    const before = approvals.length;
    const s = session(root, []);
    assert.equal((await s.callTool('read_file', { path: 'a.txt' })).ok, true);
    assert.equal((await s.callTool('list_directory', {})).ok, true);
    assert.equal((await s.callTool('find_files', { pattern: '*.txt' })).ok, true);
    assert.equal((await s.callTool('search_text', { pattern: 'hello' })).ok, true);
    assert.equal(approvals.length, before);
  });

  it('turns every failure into a result the model can read, never a crash', async () => {
    const s = session(temp(), []);
    const missing = await s.callTool('read_file', { path: 'nope.txt' });
    assert.equal(missing.ok, false);
    assert.match(missing.text, /no file or folder/);
    assert.equal((await s.callTool('format_disk', {})).ok, false);
    assert.equal((await s.callTool('read_file', null)).ok, false);
    assert.equal((await s.callTool('read_file', [])).ok, false);
  });

  it('asks before an edit, and changes nothing if the answer is no', async () => {
    const root = temp();
    const target = write(root, 'a.txt', 'one two');
    const s = session(root, ['deny']);
    await s.callTool('read_file', { path: 'a.txt' });
    const result = await s.callTool('edit_file', { path: 'a.txt', old_string: 'one', new_string: '1' });
    assert.equal(result.ok, false);
    assert.equal(result.display.denied, true);
    assert.match(result.text, /didn’t allow/);
    assert.equal(fs.readFileSync(target, 'utf8'), 'one two');
    const asked = approvals[approvals.length - 1];
    assert.equal(asked.kind, 'edit');
    assert.match(asked.title, /Edit a\.txt\?/);
    assert.match(asked.detail, /\+1 −1/);
  });

  it('applies an approved edit, and remembers “this session” for later ones', async () => {
    const root = temp();
    const target = write(root, 'a.txt', 'one two three');
    const s = session(root, ['session']);
    await s.callTool('read_file', { path: 'a.txt' });
    const first = await s.callTool('edit_file', { path: 'a.txt', old_string: 'one', new_string: '1' });
    assert.equal(first.ok, true);
    assert.equal(first.display.kind, 'edit');
    const asked = approvals.length;
    const second = await s.callTool('edit_file', { path: 'a.txt', old_string: 'two', new_string: '2' });
    assert.equal(second.ok, true);
    assert.equal(approvals.length, asked, 'no second question');
    assert.equal(fs.readFileSync(target, 'utf8'), '1 2 three');
    const created = await s.callTool('write_file', { path: 'b/new.txt', content: 'hi' });
    assert.equal(created.display.kind, 'create');
    assert.equal(fs.readFileSync(path.join(root, 'b/new.txt'), 'utf8'), 'hi');
  });

  it('treats a dismissed dialog as no', async () => {
    const root = temp();
    const s = session(root, ['cancel']);
    assert.equal((await s.callTool('write_file', { path: 'x.txt', content: 'x' })).ok, false);
    assert.ok(!fs.existsSync(path.join(root, 'x.txt')));
  });

  it('asks before running a command, and doesn’t run it if refused', async () => {
    const root = temp();
    const s = session(root, ['deny']);
    const marker = path.join(root, 'ran.txt');
    const result = await s.callTool('run_command', { command: node(`require('fs').writeFileSync('ran.txt','x')`) });
    assert.equal(result.ok, false);
    assert.ok(!fs.existsSync(marker));
    assert.equal(approvals[approvals.length - 1].kind, 'command');
  });

  it('runs an approved command in the project, with its output and exit code', async () => {
    const root = temp();
    const s = session(root, ['once']);
    const result = await s.callTool('run_command', { command: node(`console.log('hello from', require('path').basename(process.cwd())); process.exit(3)`) });
    assert.equal(result.ok, true);
    assert.match(result.text, /hello from /);
    assert.match(result.text, /exited with code 3/);
    assert.equal(result.display.exitCode, 3);
  });

  it('remembers an exact command for the session, but not a different one', async () => {
    const root = temp();
    const s = session(root, ['session', 'deny']);
    const command = node(`console.log(1)`);
    await s.callTool('run_command', { command });
    const asked = approvals.length;
    assert.equal((await s.callTool('run_command', { command })).ok, true);
    assert.equal(approvals.length, asked);
    assert.equal((await s.callTool('run_command', { command: node(`console.log(2)`) })).ok, false);
    assert.equal(approvals.length, asked + 1);
  });

  it('hides credentials from commands', async () => {
    const root = temp();
    const s = session(root, ['once'], { env: { ...process.env, QUO_TEST_TOKEN: 'hunter2', QUO_TEST_PLAIN: 'visible' } });
    const result = await s.callTool('run_command', { command: node(`console.log(process.env.QUO_TEST_TOKEN || 'no token', process.env.QUO_TEST_PLAIN)`) });
    assert.match(result.text, /no token visible/);
    assert.ok(!result.text.includes('hunter2'));
  });

  it('stops a command that runs too long', async () => {
    const s = session(temp(), ['once']);
    const started = Date.now();
    const result = await s.callTool('run_command', { command: node(`setTimeout(() => {}, 60000)`), timeout_seconds: 1 });
    assert.equal(result.display.timedOut, true);
    assert.match(result.text, /timed out after 1s/);
    assert.ok(Date.now() - started < 15000);
  });

  it('stops a command when the turn is stopped', async () => {
    const s = session(temp(), ['once']);
    const controller = new AbortController();
    const pending = s.callTool('run_command', { command: node(`setTimeout(() => {}, 60000)`) }, { signal: controller.signal });
    setTimeout(() => controller.abort(), 400);
    const result = await pending;
    assert.equal(result.display.aborted, true);
  });

  it('keeps the middle out of very long output, and removes secrets from it', async () => {
    const s = session(temp(), ['once']);
    const result = await s.callTool('run_command', { command: node(`console.log('a'.repeat(50000)); console.log('gh' + 'p_' + 'q'.repeat(36))`) });
    assert.match(result.text, /characters cut/);
    assert.ok(result.text.length < 40000);
    assert.ok(!result.text.includes('ghp_'));
  });

  it('keeps reference repositories read-only and requires opening them first', async () => {
    const s = session(temp(), []);
    const unopened = await s.callTool('read_file', { repo: 'facebook/react', path: 'README.md' });
    assert.match(unopened.text, /Open facebook\/react first/);
    const write = await s.callTool('write_file', { repo: 'facebook/react', path: 'x', content: 'x' });
    assert.match(write.text, /read-only/);
    const unavailable = await s.callTool('open_repo', { repo: 'facebook/react' });
    assert.equal(unavailable.ok, false);
  });

  it('has a limit on tool calls', async () => {
    const s = session(temp(), []);
    s.calls = 500;
    assert.equal((await s.callTool('list_directory', {})).display.code, 'limit');
  });
});
