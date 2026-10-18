'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const files = require('../../src/agent/files');
const { temp, write, rejects, ctxFor, trySymlink } = require('./helpers');

describe('changing files', () => {
  it('needs the file read first, and unchanged since', async () => {
    const root = temp();
    const target = write(root, 'a.js', 'const a = 1;\nconst b = 2;\n');
    const ctx = ctxFor(root);
    await rejects(files.planEdit(ctx, { path: 'a.js', old_string: 'a = 1', new_string: 'a = 3' }), 'read_first');
    await files.readFile(ctx, { path: 'a.js' });
    fs.writeFileSync(target, 'const a = 1;\nconst b = 9;\n'); // changed behind our back
    await rejects(files.planEdit(ctx, { path: 'a.js', old_string: 'a = 1', new_string: 'a = 3' }), 'changed');
  });

  it('plans an exact replacement without writing, then writes it when applied', async () => {
    const root = temp();
    const target = write(root, 'a.js', 'const a = 1;\nconst b = 2;\nconst c = 3;\n');
    const ctx = ctxFor(root);
    await files.readFile(ctx, { path: 'a.js' });
    const plan = await files.planEdit(ctx, { path: 'a.js', old_string: 'b = 2', new_string: 'b = 20' });
    assert.equal(fs.readFileSync(target, 'utf8'), 'const a = 1;\nconst b = 2;\nconst c = 3;\n', 'planning changes nothing');
    assert.equal(plan.added, 1);
    assert.equal(plan.removed, 1);
    assert.match(plan.diff, /-const b = 2;\n\+const b = 20;/);
    await files.applyPlan(ctx, plan);
    assert.equal(fs.readFileSync(target, 'utf8'), 'const a = 1;\nconst b = 20;\nconst c = 3;\n');
    // The session's view moved on with the write, so a second edit needs no re-read.
    const next = await files.planEdit(ctx, { path: 'a.js', old_string: 'c = 3', new_string: 'c = 30' });
    assert.equal(next.replacements, 1);
  });

  it('refuses unclear or pointless edits, and edits to secrets', async () => {
    const root = temp();
    write(root, 'a.js', 'x = 1\nx = 1\n');
    write(root, '.env', 'A=1');
    const ctx = ctxFor(root);
    await files.readFile(ctx, { path: 'a.js' });
    await rejects(files.planEdit(ctx, { path: 'a.js', old_string: 'x = 1', new_string: 'x = 2' }), 'ambiguous');
    await rejects(files.planEdit(ctx, { path: 'a.js', old_string: 'y = 1', new_string: 'y = 2' }), 'not_found');
    await rejects(files.planEdit(ctx, { path: 'a.js', old_string: 'x = 1', new_string: 'x = 1' }), 'no_change');
    await rejects(files.planEdit(ctx, { path: 'a.js', old_string: '', new_string: 'x' }), 'bad_args');
    await rejects(files.planEdit(ctx, { path: '.env', old_string: 'A', new_string: 'B' }), 'secret');
    const all = await files.planEdit(ctx, { path: 'a.js', old_string: 'x = 1', new_string: 'x = 2', replace_all: true });
    assert.equal(all.replacements, 2);
  });

  it('inserts replacement text literally, whatever characters it has', async () => {
    const root = temp();
    const target = write(root, 'a.txt', 'price: PLACEHOLDER\n');
    const ctx = ctxFor(root);
    await files.readFile(ctx, { path: 'a.txt' });
    await files.applyPlan(ctx, await files.planEdit(ctx, { path: 'a.txt', old_string: 'PLACEHOLDER', new_string: "$& $1 $$ $` ''" }));
    assert.equal(fs.readFileSync(target, 'utf8'), "price: $& $1 $$ $` ''\n");
  });

  it('creates files, including in new folders, and replaces only files it has read', async () => {
    const root = temp();
    const ctx = ctxFor(root);
    const created = await files.planWrite(ctx, { path: 'src/new/deep/file.js', content: 'a\nb\n' });
    assert.equal(created.kind, 'create');
    assert.ok(!fs.existsSync(path.join(root, 'src')), 'planning creates nothing');
    await files.applyPlan(ctx, created);
    assert.equal(fs.readFileSync(path.join(root, 'src/new/deep/file.js'), 'utf8'), 'a\nb\n');
    const other = temp();
    write(other, 'old.txt', 'old');
    await rejects(files.planWrite(ctxFor(other), { path: 'old.txt', content: 'new' }), 'read_first');
    const ctx2 = ctxFor(other);
    await files.readFile(ctx2, { path: 'old.txt' });
    assert.equal((await files.planWrite(ctx2, { path: 'old.txt', content: 'new' })).kind, 'overwrite');
  });

  it('won’t write secrets, links, outside the project, or too much', async () => {
    const root = temp();
    const outside = temp();
    const ctx = ctxFor(root);
    await rejects(files.planWrite(ctx, { path: '.env', content: 'A=1' }), 'secret');
    await rejects(files.planWrite(ctx, { path: '.git/hooks/pre-commit', content: '#!/bin/sh' }), 'secret');
    await rejects(files.planWrite(ctx, { path: '../escape.txt', content: 'x' }), 'outside_project');
    await rejects(files.planWrite(ctx, { path: 'big.txt', content: 'x'.repeat(files.LIMITS.maxWriteBytes + 1) }), 'too_large');
    await rejects(files.planWrite(ctx, { path: '.', content: 'x' }), 'bad_path');
    write(outside, 'target.txt', 'x');
    if (trySymlink(path.join(outside, 'target.txt'), path.join(root, 'link.txt'))) {
      await rejects(files.planWrite(ctx, { path: 'link.txt', content: 'overwritten' }), 'outside_project');
    }
    if (trySymlink(outside, path.join(root, 'linkdir'))) {
      await rejects(files.planWrite(ctx, { path: 'linkdir/new.txt', content: 'x' }), 'outside_project');
      assert.ok(!fs.existsSync(path.join(outside, 'new.txt')));
    }
  });

  it('shows a diff with a little context, and counts the changes', () => {
    const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'].join('\n');
    const after = ['a', 'b', 'c', 'd', 'E', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm'].join('\n');
    const diff = files.unifiedDiff(before, after);
    assert.equal(diff.added, 2);
    assert.equal(diff.removed, 1);
    assert.match(diff.text, /-e\n\+E/);
    assert.match(diff.text, /\+m/);
    assert.equal(files.unifiedDiff('same', 'same').added, 0);
  });

  it('won’t change settings that run commands on their own, but reads them', async () => {
    const root = temp();
    write(root, '.vscode/tasks.json', '{}');
    write(root, '.husky/pre-commit', 'npm test');
    write(root, '.envrc', 'export A=1');
    write(root, 'src/app.js', 'x');
    const ctx = ctxFor(root);
    for (const file of ['.vscode/tasks.json', '.husky/pre-commit', '.envrc']) {
      await files.readFile(ctx, { path: file });
      await rejects(files.planEdit(ctx, { path: file, old_string: '{', new_string: '[' }), 'protected');
      await rejects(files.planWrite(ctx, { path: file, content: 'x' }), 'protected');
    }
    await rejects(files.planWrite(ctx, { path: '.devcontainer/devcontainer.json', content: '{}' }), 'protected');
    await rejects(files.planWrite(ctx, { path: '.claude/settings.json', content: '{}' }), 'protected');
    assert.equal((await files.planWrite(ctx, { path: 'src/new.js', content: 'ok' })).kind, 'create');
  });
});
