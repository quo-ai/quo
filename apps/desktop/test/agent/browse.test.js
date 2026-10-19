'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const { AgentSession } = require('../../src/agent/session');
const { listEntries, viewFile, existing, MAX_ENTRIES, MAX_TEXT_BYTES } = require('../../src/agent/files/browse');
const { temp, write, trySymlink } = require('./helpers');

const ctx = root => ({ rootReal: root });

describe('the file panel: folders', () => {
  it('lists folders first, then files, by name, and says which folders are build output or dependencies', async () => {
    const root = temp();
    write(root, 'b.txt', 'b');
    write(root, 'A.md', 'a');
    write(root, 'src/index.js', 'x');
    write(root, 'node_modules/pkg/index.js', 'x');
    write(root, 'file10.txt', '10');
    write(root, 'file9.txt', '9');
    const result = await listEntries(ctx(root), '.');
    assert.deepEqual(result.entries.map(e => e.name), ['node_modules', 'src', 'A.md', 'b.txt', 'file9.txt', 'file10.txt']);
    assert.equal(result.entries.find(e => e.name === 'node_modules').ignored, true);
    assert.equal(result.entries.find(e => e.name === 'src').ignored, false);
    const sub = await listEntries(ctx(root), 'src');
    assert.deepEqual(sub.entries.map(e => e.path), ['src/index.js']);
  });

  it('never lists secrets or .git, and will not open a secrets folder', async () => {
    const root = temp();
    write(root, '.env', 'A=1');
    write(root, '.env.example', 'A=');
    write(root, '.git/config', '[core]');
    write(root, '.ssh/id_rsa', 'k');
    write(root, 'id_rsa', 'k');
    write(root, 'cert.pem', 'c');
    write(root, 'ok.js', 'x');
    const names = (await listEntries(ctx(root), '.')).entries.map(e => e.name);
    assert.deepEqual(names.sort(), ['.env.example', 'ok.js']);
    await assert.rejects(listEntries(ctx(root), '.ssh'), error => error.code === 'secret');
    await assert.rejects(listEntries(ctx(root), '.git'), error => error.code === 'secret');
  });

  it('stays inside the project, and leaves out links that lead out', async () => {
    const root = temp();
    const outside = temp();
    write(outside, 'x.txt', 'x');
    write(root, 'in/a.txt', 'a');
    for (const bad of ['..', '../', '/', outside, 'in/../..']) await assert.rejects(listEntries(ctx(root), bad), error => ['outside_project', 'not_folder', 'bad_path'].includes(error.code), bad);
    if (trySymlink(outside, path.join(root, 'out-link')) && trySymlink(path.join(root, 'in'), path.join(root, 'in-link'))) {
      const names = (await listEntries(ctx(root), '.')).entries.map(e => e.name);
      assert.ok(!names.includes('out-link'));
      assert.ok(names.includes('in-link'));
      await assert.rejects(listEntries(ctx(root), 'out-link'), error => error.code === 'outside_project');
    }
  });

  it('is capped for a huge folder, and refuses a file', async () => {
    const root = temp();
    for (let i = 0; i < MAX_ENTRIES + 20; i++) fs.writeFileSync(path.join(root, `f${i}.txt`), '');
    const result = await listEntries(ctx(root), '.');
    assert.equal(result.entries.length, MAX_ENTRIES);
    assert.equal(result.truncated, true);
    await assert.rejects(listEntries(ctx(root), 'f1.txt'), error => error.code === 'not_folder');
  });
});

describe('the file panel: one file', () => {
  it('shows text with its line count, says if it was cut, and whether a browser can open it', async () => {
    const root = temp();
    write(root, 'a.js', 'one\ntwo\nthree');
    write(root, 'index.html', '<p>hi</p>');
    write(root, 'big.txt', 'x'.repeat(MAX_TEXT_BYTES + 1000));
    const a = await viewFile(ctx(root), 'a.js');
    assert.deepEqual({ kind: a.kind, text: a.text, lines: a.lines, canOpen: a.canOpen, clipped: a.clipped }, { kind: 'text', text: 'one\ntwo\nthree', lines: 3, canOpen: false, clipped: false });
    assert.equal((await viewFile(ctx(root), 'index.html')).canOpen, true);
    const big = await viewFile(ctx(root), 'big.txt');
    assert.equal(big.clipped, true);
    assert.equal(big.text.length, MAX_TEXT_BYTES);
  });

  it('shows an image as a data address, and a binary file as binary', async () => {
    const root = temp();
    fs.writeFileSync(path.join(root, 'p.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]));
    fs.writeFileSync(path.join(root, 'data.bin'), Buffer.from([1, 2, 0, 3, 0, 0]));
    write(root, 'logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
    assert.match((await viewFile(ctx(root), 'p.png')).dataUrl, /^data:image\/png;base64,/);
    assert.equal((await viewFile(ctx(root), 'data.bin')).kind, 'binary');
    assert.match((await viewFile(ctx(root), 'logo.svg')).dataUrl, /^data:image\/svg\+xml;base64,/);
  });

  it('refuses secrets, folders and anything outside the project', async () => {
    const root = temp();
    const outside = temp();
    write(root, '.env', 'KEY=1');
    write(root, 'sub/x.txt', 'x');
    write(outside, 'o.txt', 'o');
    for (const bad of ['.env', '.git/config', 'sub', '../o.txt', path.join(outside, 'o.txt'), '', 'missing.txt']) await assert.rejects(viewFile(ctx(root), bad), () => true, bad);
    if (trySymlink(path.join(outside, 'o.txt'), path.join(root, 'link.txt'))) await assert.rejects(viewFile(ctx(root), 'link.txt'), error => error.code === 'outside_project');
  });
});

describe('the file panel: which mentioned paths are real', () => {
  it('keeps files in the project, drops everything else, and is capped', () => {
    const root = temp();
    write(root, 'src/a.ts', 'x');
    write(root, '.env', 'k');
    const outside = temp();
    write(outside, 'o.ts', 'o');
    const found = existing(ctx(root), ['src/a.ts', 'src', 'nope.ts', '.env', '../o.ts', path.join(outside, 'o.ts'), 7, null, 'x'.repeat(500), path.join(root, 'src', 'a.ts')]);
    assert.deepEqual(found, ['src/a.ts', path.join(root, 'src', 'a.ts')]);
    assert.deepEqual(existing(ctx(root), 'not a list'), []);
    assert.equal(existing(ctx(root), Array(500).fill('src/a.ts')).length, 200);
  });
});

describe('what the agent changed, for the Changes tab', () => {
  it('lists each file once with its net change, newest first, and the diff', async () => {
    const root = temp();
    write(root, 'a.txt', 'one\n');
    const s = new AgentSession({ root, name: 'demo', approve: async () => 'once' });
    await s.callTool('read_file', { path: 'a.txt' });
    await s.callTool('edit_file', { path: 'a.txt', old_string: 'one', new_string: 'two' });
    await s.callTool('edit_file', { path: 'a.txt', old_string: 'two', new_string: 'three' });
    await s.callTool('write_file', { path: 'new.txt', content: 'hello\n' });
    const changes = s.changes();
    assert.deepEqual(changes.map(c => c.path), ['new.txt', 'a.txt']);
    assert.equal(changes[0].created, true);
    assert.equal(changes[1].created, false);
    assert.match(changes[1].diff, /-one\n\+three/, 'one net change from the first text to the last');
    assert.deepEqual(new AgentSession({ root: temp(), name: 'x', approve: async () => 'deny' }).changes(), []);
  });
});
