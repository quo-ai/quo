'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const { strToU8, zipSync } = require('fflate');
const { RepoCache, cleanName, parseRepo } = require('../../src/agent/repos');
const { AgentSession } = require('../../src/agent/session');
const { temp, write, rejects, throwsCode, trySymlink } = require('./helpers');

describe('reference repositories', () => {
  const zipResponse = (entries, status = 200) => new Response(Buffer.from(zipSync(Object.fromEntries(Object.entries(entries).map(([name, content]) => [name, typeof content === 'string' ? strToU8(content) : content])))), { status });
  const cacheWith = (handler, limits) => new RepoCache({ directory: path.join(temp(), 'repos'), fetchFn: async (url, init) => handler(String(url), init), limits });

  it('checks owner, name and ref, and takes a GitHub address too', () => {
    assert.equal(parseRepo('facebook/react').name, 'facebook/react');
    assert.equal(parseRepo('https://github.com/facebook/react.git/').name, 'facebook/react');
    assert.equal(parseRepo('a/b', 'feature/x-1').ref, 'feature/x-1');
    assert.equal(parseRepo('a/b').ref, 'HEAD');
    for (const bad of ['react', 'a/b/c', '../x', 'a/..', '-a/b', 'a b/c', 'a/b?x=1', 'a/b#x', '', undefined, 'http://evil.com/a/b/c']) {
      assert.throws(() => parseRepo(bad), error => error.code === 'bad_repo', String(bad));
    }
    for (const bad of ['../x', 'a/../b', 'x y', 'a?b=c', 'a%2e%2e', '/abs', 'x'.repeat(101)]) {
      assert.throws(() => parseRepo('a/b', bad), error => error.code === 'bad_ref', bad);
    }
  });

  it('cleans zip entry names and drops anything that could escape', () => {
    assert.equal(cleanName('react-main/src/index.js'), 'src/index.js');
    for (const bad of ['react-main/../../etc/passwd', '/etc/passwd', 'react-main/a\\b', 'C:/x', 'react-main/a:b', 'react-main/con ', 'react-main/a//b', 'react-main/./a', 'react-main/a\u0000b']) assert.equal(cleanName(bad), null, bad);
    assert.equal(cleanName('react-main/'), null);
    assert.equal(cleanName('react-main'), null);
  });

  it('downloads from GitHub’s download host only, unpacks it, and describes it', async () => {
    const urls = [];
    const cache = cacheWith(url => {
      urls.push(url);
      return zipResponse({ 'demo-main/README.md': '# Demo\nA demo.', 'demo-main/src/a.js': 'export const a = 1;', 'demo-main/src/deep/b.js': 'b' });
    });
    const repo = await cache.open('someone/demo', 'main');
    assert.deepEqual(urls, ['https://codeload.github.com/someone/demo/zip/main']);
    assert.equal(fs.readFileSync(path.join(repo.root, 'src/a.js'), 'utf8'), 'export const a = 1;');
    assert.deepEqual(repo.top, ['src/', 'README.md']);
    assert.match(repo.excerpt, /# Demo/);
  });

  it('skips unsafe entries, secrets, dependencies and big files, and never writes outside the folder', async () => {
    const outside = temp();
    const cache = cacheWith(() => zipResponse({
      'r-main/ok.txt': 'fine',
      'r-main/../../escape.txt': 'bad',
      'r-main/.env': 'SECRET=1',
      'r-main/keys/id_rsa': 'key',
      'r-main/node_modules/pkg/index.js': 'dep',
      'r-main/.git/config': '[remote "origin"]\nurl = https://github.com/x/y',
      'r-main/big.bin': new Uint8Array(3 * 1024 * 1024),
      'r-main/dist/out.js': 'built output is kept',
    }));
    const repo = await cache.open('o/r');
    const present = fs.readdirSync(repo.root, { recursive: true }).map(String).map(name => name.split(path.sep).join('/')).sort();
    assert.deepEqual(present.filter(name => !name.endsWith('/') && fs.statSync(path.join(repo.root, name)).isFile()).sort(), ['dist/out.js', 'ok.txt']);
    assert.ok(!fs.existsSync(path.join(path.dirname(repo.root), 'escape.txt')));
    assert.ok(!fs.existsSync(path.join(outside, 'escape.txt')));
  });

  it('refuses downloads that are too big, too many files, or from somewhere else', async () => {
    const big = cacheWith(() => zipResponse({ 'r-main/a.txt': 'x'.repeat(5000) }), { zipBytes: 100 });
    await rejects(big.open('o/r'), 'too_large');
    const crowded = cacheWith(() => zipResponse(Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`r-main/f${i}.txt`, 'x']))), { files: 10 });
    await rejects(crowded.open('o/r'), 'too_large');
    const heavy = cacheWith(() => zipResponse({ 'r-main/a.txt': 'x'.repeat(5000), 'r-main/b.txt': 'x'.repeat(5000) }), { unpackedBytes: 6000 });
    await rejects(heavy.open('o/r'), 'too_large');
    const elsewhere = cacheWith(() => new Response(null, { status: 302, headers: { location: 'https://evil.example/r.zip' } }));
    await rejects(elsewhere.open('o/r'), 'bad_redirect');
    const plain = cacheWith(() => new Response(null, { status: 302, headers: { location: 'http://codeload.github.com/r.zip' } }));
    await rejects(plain.open('o/r'), 'bad_redirect');
  });

  it('says plainly when a repository isn’t there, is private, or GitHub can’t be reached', async () => {
    await rejects(cacheWith(() => new Response('', { status: 404 })).open('o/r'), 'repo_not_found');
    await rejects(cacheWith(() => new Response('', { status: 429 })).open('o/r'), 'rate_limited');
    await rejects(cacheWith(() => new Response('', { status: 500 })).open('o/r'), 'download_failed');
    await rejects(cacheWith(() => { throw new TypeError('fetch failed'); }).open('o/r'), 'offline');
  });

  it('reuses what it has, refreshes after a day, and removes the least recently used when full', async () => {
    let downloads = 0;
    let clock = 1_000_000;
    const cache = new RepoCache({
      directory: path.join(temp(), 'repos'),
      fetchFn: async () => {
        downloads++;
        return zipResponse({ 'r-main/a.txt': 'x'.repeat(1000) });
      },
      now: () => clock,
      limits: { cacheBytes: 2500 },
    });
    const first = await cache.open('o/one');
    await cache.open('o/one');
    assert.equal(downloads, 1, 'second open reuses the download');
    clock += 25 * 60 * 60 * 1000;
    await cache.open('o/one');
    assert.equal(downloads, 2, 'a day later it is fetched again');
    await cache.open('o/two');
    await cache.open('o/three');
    assert.ok(!fs.existsSync(first.root), 'the oldest was removed to stay under the limit');
    const kept = await cache.open('o/three');
    assert.ok(fs.existsSync(kept.root));
  });

  it('lets a session read an opened repository, and nothing outside it', async () => {
    const cache = cacheWith(() => zipResponse({ 'lib-main/README.md': 'Library', 'lib-main/src/core.js': 'export function core() {}' }));
    const root = temp();
    write(root, 'mine.txt', 'mine');
    const s = new AgentSession({ root, name: 'demo', approve: async () => 'deny', repos: cache });
    const opened = await s.callTool('open_repo', { repo: 'someone/lib' });
    assert.equal(opened.ok, true);
    assert.match(opened.text, /Opened someone\/lib/);
    assert.match(opened.text, /Library/);
    assert.match((await s.callTool('read_file', { repo: 'someone/lib', path: 'src/core.js' })).text, /export function core/);
    assert.match((await s.callTool('search_text', { repo: 'Someone/Lib', pattern: 'core' })).text, /src\/core\.js:1/);
    assert.equal((await s.callTool('read_file', { repo: 'someone/lib', path: '../../mine.txt' })).ok, false);
    assert.equal((await s.callTool('read_file', { path: 'src/core.js' })).ok, false, 'the project doesn’t see the repository’s files');
    assert.equal((await s.callTool('edit_file', { repo: 'someone/lib', path: 'src/core.js', old_string: 'a', new_string: 'b' })).display.code, 'read_only');
  });
});
