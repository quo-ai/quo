'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const { createWorkspace, slugOf, MAX_FOLDERS } = require('../../src/agent/workspace');
const { temp, trySymlink } = require('./helpers');

describe('project folders made by the app', () => {
  it('names them from the request, in a safe alphabet only', () => {
    assert.equal(slugOf('Build me a Todo app!'), 'build-me-a-todo-app');
    assert.equal(slugOf('  Crème brûlée recipes  '), 'creme-brulee-recipes');
    assert.equal(slugOf('../../etc/passwd'), 'etc-passwd');
    assert.equal(slugOf('..'), 'project');
    assert.equal(slugOf('C:\\Windows\\System32'), 'c-windows-system32');
    assert.equal(slugOf('日本語のアプリ'), 'project');
    assert.equal(slugOf(undefined), 'project');
    assert.equal(slugOf('a'.repeat(200)).length, 40);
    assert.doesNotMatch(slugOf('x'.repeat(39) + ' y'), /-$/);
    assert.match(slugOf('.hidden'), /^hidden$/);
  });

  it('creates an empty folder under the parent, and a new one each time the name repeats', async () => {
    const parent = path.join(temp(), 'Quo Projects');
    const first = await createWorkspace(parent, 'Todo app');
    const second = await createWorkspace(parent, 'Todo app');
    assert.equal(path.basename(first), 'todo-app');
    assert.equal(path.basename(second), 'todo-app-2');
    assert.deepEqual(fs.readdirSync(first), []);
    assert.equal(path.dirname(first), fs.realpathSync(parent));
  });

  it('never goes outside the parent, whatever the name', async () => {
    const parent = path.join(temp(), 'Quo Projects');
    for (const name of ['../../escape', '/etc', '..\\..\\x', 'a/b/c', '\0x']) {
      const made = await createWorkspace(parent, name);
      assert.equal(path.dirname(made), fs.realpathSync(parent), name);
    }
  });

  it('never reuses or writes through something already there, even a link', async () => {
    const base = temp();
    const parent = path.join(base, 'Quo Projects');
    fs.mkdirSync(parent);
    const outside = temp();
    if (trySymlink(outside, path.join(parent, 'sneaky'))) {
      const made = await createWorkspace(parent, 'sneaky');
      assert.equal(path.basename(made), 'sneaky-2');
      assert.deepEqual(fs.readdirSync(outside), []);
    }
  });

  it('stops at a cap', async () => {
    const parent = path.join(temp(), 'Quo Projects');
    fs.mkdirSync(parent);
    for (let i = 0; i < MAX_FOLDERS; i++) fs.mkdirSync(path.join(parent, `p${i}`));
    await assert.rejects(createWorkspace(parent, 'one more'), error => error.code === 'too_many');
  });
});
