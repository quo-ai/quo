'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const { ChangeLog } = require('../../src/agent/history');
const { AgentSession } = require('../../src/agent/session');
const { ctxFor, temp, write } = require('./helpers');

const read = (root, file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (root, file) => fs.existsSync(path.join(root, file));

describe('taking changes back', () => {
  it('puts back the last changes, newest first, and removes a file that was created', () => {
    const root = temp();
    write(root, 'a.txt', 'one');
    const log = new ChangeLog();
    write(root, 'a.txt', 'two');
    log.record({ relative: 'a.txt', before: 'one', after: 'two' });
    write(root, 'a.txt', 'three');
    log.record({ relative: 'a.txt', before: 'two', after: 'three' });
    write(root, 'new/b.txt', 'made');
    log.record({ relative: 'new/b.txt', before: null, after: 'made' });
    return log.undo(ctxFor(root), 3).then(result => {
      assert.deepEqual(result, { restored: ['new/b.txt', 'a.txt', 'a.txt'], skipped: [] });
      assert.equal(read(root, 'a.txt'), 'one');
      assert.equal(exists(root, 'new/b.txt'), false);
      assert.equal(log.size, 0);
    });
  });

  it('takes back only as many as asked, and nothing beyond what there is', async () => {
    const root = temp();
    const log = new ChangeLog();
    for (const [before, after] of [['a', 'b'], ['b', 'c']]) {
      write(root, 'f.txt', after);
      log.record({ relative: 'f.txt', before, after });
    }
    assert.deepEqual((await log.undo(ctxFor(root), 1)).restored, ['f.txt']);
    assert.equal(read(root, 'f.txt'), 'b');
    assert.equal(log.size, 1);
    assert.deepEqual(await log.undo(ctxFor(root), 0), { restored: [], skipped: [] });
    assert.deepEqual((await log.undo(ctxFor(root), 99)).restored, ['f.txt']);
    assert.deepEqual(await log.undo(ctxFor(root), 1), { restored: [], skipped: [] });
  });

  it('leaves a file alone that was changed again since, instead of overwriting the person’s work', async () => {
    const root = temp();
    const log = new ChangeLog();
    write(root, 'a.txt', 'agent version');
    log.record({ relative: 'a.txt', before: 'original', after: 'agent version' });
    write(root, 'a.txt', 'the person edited this');
    assert.deepEqual(await log.undo(ctxFor(root), 1), { restored: [], skipped: ['a.txt'] });
    assert.equal(read(root, 'a.txt'), 'the person edited this');
  });

  it('copes with files that are gone, and never writes outside the project', async () => {
    const root = temp();
    const log = new ChangeLog();
    log.record({ relative: 'gone.txt', before: null, after: 'x' });
    log.record({ relative: 'deleted-later.txt', before: 'old', after: 'new' });
    log.record({ relative: '../escape.txt', before: 'x', after: 'y' });
    const result = await log.undo(ctxFor(root), 3);
    assert.deepEqual(result.restored, []);
    assert.deepEqual(result.skipped.sort(), ['../escape.txt', 'deleted-later.txt']);
    assert.equal(exists(path.dirname(root), 'escape.txt'), false);
  });

  it('makes the model read a file again after it was taken back', async () => {
    const root = temp();
    const file = write(root, 'a.txt', 'new');
    const ctx = ctxFor(root);
    ctx.reads.set(file, 'hash');
    const log = new ChangeLog();
    log.record({ relative: 'a.txt', before: 'old', after: 'new' });
    await log.undo(ctx, 1);
    assert.equal(ctx.reads.has(file), false);
  });

  it('keeps a bounded number of changes', () => {
    const log = new ChangeLog();
    for (let i = 0; i < 250; i++) log.record({ relative: `f${i}.txt`, before: null, after: 'x' });
    assert.equal(log.size, 200);
    const big = new ChangeLog();
    for (let i = 0; i < 5; i++) big.record({ relative: 'big.txt', before: 'a'.repeat(6 * 1024 * 1024), after: 'b' });
    assert.ok(big.size < 5 && big.size >= 1);
  });
});

describe('a session and undo', () => {
  const session = (root, answers) => {
    const queue = [...answers];
    return new AgentSession({ root, name: 'demo', approve: async () => queue.shift() ?? 'deny' });
  };

  it('undoes what it changed, whether edited, replaced or created', async () => {
    const root = temp();
    write(root, 'a.txt', 'hello world');
    write(root, 'b.txt', 'keep me');
    const agent = session(root, ['once', 'once', 'once']);
    await agent.callTool('read_file', { path: 'a.txt' });
    await agent.callTool('read_file', { path: 'b.txt' });
    assert.equal((await agent.callTool('edit_file', { path: 'a.txt', old_string: 'world', new_string: 'there' })).ok, true);
    assert.equal((await agent.callTool('write_file', { path: 'b.txt', content: 'replaced' })).ok, true);
    assert.equal((await agent.callTool('write_file', { path: 'c.txt', content: 'brand new' })).ok, true);
    const result = await agent.undo(3);
    assert.deepEqual(result.restored.sort(), ['a.txt', 'b.txt', 'c.txt']);
    assert.equal(read(root, 'a.txt'), 'hello world');
    assert.equal(read(root, 'b.txt'), 'keep me');
    assert.equal(exists(root, 'c.txt'), false);
  });

  it('has nothing to undo for changes the person declined', async () => {
    const root = temp();
    write(root, 'a.txt', 'x');
    const agent = session(root, ['deny']);
    await agent.callTool('read_file', { path: 'a.txt' });
    await agent.callTool('edit_file', { path: 'a.txt', old_string: 'x', new_string: 'y' });
    assert.deepEqual(await agent.undo(1), { restored: [], skipped: [] });
    assert.equal(read(root, 'a.txt'), 'x');
  });
});
