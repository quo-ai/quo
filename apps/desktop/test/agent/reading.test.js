'use strict';

const assert = require('node:assert/strict');
const { before, describe, it } = require('node:test');
const files = require('../../src/agent/files');
const { temp, write, rejects, ctxFor, trySymlink } = require('./helpers');

describe('reading', () => {
  let root;
  before(() => {
    root = temp();
    write(root, 'package.json', '{"name":"demo"}\n');
    write(root, 'src/app.js', Array.from({ length: 1000 }, (_, i) => `line ${i + 1}`).join('\n'));
    write(root, 'src/util/math.ts', 'export const add = (a: number, b: number) => a + b;\n');
    write(root, 'node_modules/dep/index.js', 'needle in dependencies');
    write(root, '.env', 'API_TOKEN=supersecret');
    write(root, 'notes.bin', Buffer.from([1, 2, 0, 3]));
    write(root, 'huge.txt', 'x'.repeat(files.LIMITS.maxFileBytes + 1));
  });

  it('lists a folder, folders first, skipping dependencies', async () => {
    const result = await files.listDirectory(ctxFor(root), {});
    assert.match(result.text, /^Project folder\/\nnode_modules\/ \(skipped/m);
    assert.match(result.text, /src\/\n/);
    assert.match(result.text, /package\.json \(\d+ B\)/);
    assert.ok(result.text.indexOf('src/') < result.text.indexOf('package.json'));
    const deep = await files.listDirectory(ctxFor(root), { depth: 2 });
    assert.match(deep.text, / {2}util\//);
    await rejects(files.listDirectory(ctxFor(root), { path: 'package.json' }), 'not_directory');
  });

  it('reads numbered lines, in pages, and says how to read on', async () => {
    const first = await files.readFile(ctxFor(root), { path: 'src/app.js' });
    assert.match(first.text, /^src\/app\.js \(lines 1-400 of 1000\)/);
    assert.match(first.text, /\n {2}1\tline 1\n/);
    assert.match(first.text, /Read on with start_line=401/);
    const page = await files.readFile(ctxFor(root), { path: 'src/app.js', start_line: 998, end_line: 5000 });
    assert.match(page.text, /lines 998-1000 of 1000/);
    assert.ok(!page.text.includes('more lines'));
    assert.deepEqual(page.display, { kind: 'read', path: 'src/app.js', from: 998, to: 1000, total: 1000 });
  });

  it('refuses secrets, binaries, huge files, folders and anything outside', async () => {
    await rejects(files.readFile(ctxFor(root), { path: '.env' }), 'secret');
    await rejects(files.readFile(ctxFor(root), { path: 'notes.bin' }), 'binary');
    await rejects(files.readFile(ctxFor(root), { path: 'huge.txt' }), 'too_large');
    await rejects(files.readFile(ctxFor(root), { path: 'src' }), 'not_file');
    await rejects(files.readFile(ctxFor(root), { path: '../etc/passwd' }), 'outside_project');
    await rejects(files.readFile(ctxFor(root), { path: 'missing.js' }), 'not_found');
    await rejects(files.readFile(ctxFor(root), {}), 'bad_args');
  });

  it('removes secret formats from what it reads', async () => {
    write(root, 'config.js', `const token = 'ghp_${'z'.repeat(36)}';\nexport default token;\n`);
    const result = await files.readFile(ctxFor(root), { path: 'config.js' });
    assert.ok(!result.text.includes('ghp_'));
    assert.match(result.text, /\[token removed\]/);
  });

  it('finds files by pattern, never in dependencies or secrets', async () => {
    const find = async pattern => (await files.findFiles(ctxFor(root), { pattern })).text.split('\n');
    assert.deepEqual(await find('*.ts'), ['src/util/math.ts']);
    assert.deepEqual(await find('src/**/*.ts'), ['src/util/math.ts']);
    assert.deepEqual((await find('*.{json,ts}')).sort(), ['package.json', 'src/util/math.ts']);
    assert.ok((await find('*.js')).every(line => !line.includes('node_modules')));
    assert.deepEqual(await find('.env'), ['No files match .env.']);
    assert.match((await files.findFiles(ctxFor(root), { pattern: '*.zzz' })).text, /No files match/);
  });

  it('searches text, skipping dependencies, secrets and binaries', async () => {
    const hits = await files.searchText(ctxFor(root), { pattern: 'add' });
    assert.match(hits.text, /^src\/util\/math\.ts:1: export const add/);
    assert.ok(!hits.text.includes('node_modules'));
    assert.match((await files.searchText(ctxFor(root), { pattern: 'supersecret' })).text, /No matches/);
    assert.match((await files.searchText(ctxFor(root), { pattern: 'needle' })).text, /No matches/); // only in node_modules
    const insensitive = await files.searchText(ctxFor(root), { pattern: 'LINE 1000' });
    assert.match(insensitive.text, /src\/app\.js:1000/);
    assert.match((await files.searchText(ctxFor(root), { pattern: 'LINE 1000', case_sensitive: true })).text, /No matches/);
    assert.match((await files.searchText(ctxFor(root), { pattern: 'name', glob: '*.json' })).text, /^package\.json:1:/);
  });

  it('searches with regular expressions, and gives up on one that would never finish', async () => {
    const re = await files.searchText(ctxFor(root), { pattern: '^line 99\\d$', regex: true, max_results: 5 });
    assert.match(re.text, /src\/app\.js:991: line 991/);
    await rejects(files.searchText(ctxFor(root), { pattern: '(', regex: true }), 'bad_pattern');
    const evil = temp();
    write(evil, 'a.txt', `${'a'.repeat(60)}b`);
    const started = Date.now();
    await rejects(files.searchText(ctxFor(evil), { pattern: '(a+)+$', regex: true }), 'slow_pattern');
    assert.ok(Date.now() - started < 5000, 'a runaway pattern is cut off quickly');
  });

  it('caps what a search returns', async () => {
    const many = temp();
    write(many, 'a.txt', Array.from({ length: 300 }, () => 'hit').join('\n'));
    const result = await files.searchText(ctxFor(many), { pattern: 'hit', max_results: 20 });
    assert.equal(result.text.split('\n').filter(line => line.startsWith('a.txt:')).length, 20);
    assert.match(result.text, /reached 20 results/);
  });
});
