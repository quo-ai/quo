'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const zlib = require('node:zlib');
const { describe, it } = require('node:test');
const { fetchPage } = require('../../src/web/page');
const { extractReadable, needsRendering } = require('../../src/web/extract');

async function site(handler) {
  const seen = [];
  const server = http.createServer((request, response) => { seen.push({ url: request.url, headers: request.headers }); handler(request, response); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, seen, close: () => { server.closeAllConnections?.(); server.close(); } };
}
const rejects = (promise, code) => assert.rejects(promise, error => error.code === code, `expected ${code}`);
const open = { allowPrivate: true };

describe('fetching a page', () => {
  it('refuses this computer unless a test allows it, before connecting', async () => {
    const s = await site((_q, r) => r.end('secret'));
    try {
      await rejects(fetchPage(`${s.url}/`), 'blocked');
      await rejects(fetchPage('http://localhost:1/'), 'blocked');
      assert.equal(s.seen.length, 0);
    } finally { s.close(); }
  });

  it('reads a page, saying what it is and sending nothing about the user', async () => {
    const s = await site((_q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end('<title>Hi</title><p>Hello</p>'); });
    try {
      const page = await fetchPage(`${s.url}/hello`, open);
      assert.match(page.text, /Hello/);
      assert.equal(page.status, 200);
      assert.equal(page.url, `${s.url}/hello`);
      const { headers } = s.seen[0];
      assert.match(headers['user-agent'], /^Quo\//);
      assert.equal(headers.cookie, undefined);
      assert.equal(headers.authorization, undefined);
      assert.equal(headers.referer, undefined);
    } finally { s.close(); }
  });

  it('follows redirects, relative or not, up to a limit', async () => {
    const s = await site((q, r) => {
      if (q.url === '/a') { r.writeHead(302, { location: '/b' }); return r.end(); }
      if (q.url === '/b') { r.writeHead(301, { location: `http://127.0.0.1:${q.socket.localPort}/c` }); return r.end(); }
      if (q.url === '/loop') { r.writeHead(302, { location: '/loop' }); return r.end(); }
      r.writeHead(200, { 'content-type': 'text/plain' }); r.end('arrived');
    });
    try {
      const page = await fetchPage(`${s.url}/a`, open);
      assert.equal(page.text, 'arrived');
      assert.equal(page.url, `${s.url}/c`);
      await rejects(fetchPage(`${s.url}/loop`, open), 'redirects');
    } finally { s.close(); }
  });

  it('refuses a redirect to somewhere inside, and one to another scheme', async () => {
    const s = await site((q, r) => { r.writeHead(302, { location: q.url === '/file' ? 'file:///etc/passwd' : 'http://169.254.169.254/latest/' }); r.end(); });
    try {
      await rejects(fetchPage(`${s.url}/meta`, { limits: {}, allowPrivate: false }).catch(error => { throw error; }), 'blocked');
    } finally { s.close(); }
    const { parseWebUrl } = require('../../src/web/guard');
    assert.throws(() => parseWebUrl('http://169.254.169.254/latest/'), error => error.code === 'blocked');
    assert.throws(() => parseWebUrl('file:///etc/passwd'), error => error.code === 'bad_url');
  });

  it('undoes compression, reads the declared character set, and cuts off a huge page', async () => {
    const big = 'x'.repeat(500_000);
    const s = await site((q, r) => {
      if (q.url === '/gzip') { r.writeHead(200, { 'content-type': 'text/plain', 'content-encoding': 'gzip' }); return r.end(zlib.gzipSync('compressed text')); }
      if (q.url === '/br') { r.writeHead(200, { 'content-type': 'text/plain', 'content-encoding': 'br' }); return r.end(zlib.brotliCompressSync('brotli text')); }
      if (q.url === '/latin') { r.writeHead(200, { 'content-type': 'text/html; charset=iso-8859-1' }); return r.end(Buffer.from('caf\xe9', 'latin1')); }
      r.writeHead(200, { 'content-type': 'text/plain' }); r.end(big);
    });
    try {
      assert.equal((await fetchPage(`${s.url}/gzip`, open)).text, 'compressed text');
      assert.equal((await fetchPage(`${s.url}/br`, open)).text, 'brotli text');
      assert.equal((await fetchPage(`${s.url}/latin`, open)).text, 'café');
      const cut = await fetchPage(`${s.url}/big`, { ...open, limits: { maxBytes: 100_000 } });
      assert.equal(cut.text.length, 100_000);
      assert.equal(cut.truncated, true);
    } finally { s.close(); }
  });

  it('says why when it can’t read the answer', async () => {
    const s = await site((q, r) => {
      if (q.url === '/missing') { r.writeHead(404); return r.end('no'); }
      if (q.url === '/denied') { r.writeHead(403); return r.end('no'); }
      if (q.url === '/pdf') { r.writeHead(200, { 'content-type': 'application/pdf' }); return r.end('%PDF'); }
      if (q.url === '/image') { r.writeHead(200, { 'content-type': 'image/png' }); return r.end('x'); }
      /* /slow: never answers */
    });
    try {
      await assert.rejects(fetchPage(`${s.url}/missing`, open), error => error.code === 'http' && /404/.test(error.message));
      await assert.rejects(fetchPage(`${s.url}/denied`, open), error => error.code === 'http' && /doesn’t let Quo read/.test(error.message));
      await assert.rejects(fetchPage(`${s.url}/pdf`, open), error => error.code === 'unsupported' && /PDF/.test(error.message));
      await rejects(fetchPage(`${s.url}/image`, open), 'unsupported');
      await rejects(fetchPage(`${s.url}/slow`, { ...open, limits: { timeoutMs: 150 } }), 'timeout');
    } finally { s.close(); }
    await rejects(fetchPage('http://127.0.0.1:1/', open), 'unreachable');
  });
});

describe('the readable text of a page', () => {
  const article = `<!doctype html><html><head><title>Cats &amp; dogs</title><style>body{}</style><script>var x=1;</script></head><body>
    <nav><a href="/home">Home</a></nav>
    <article><h1>All about cats</h1><p>Cats are small &mdash; furry &amp; fast. ${'They purr. '.repeat(60)}</p>
    <h2>Care</h2><ul><li>Feed them</li><li>Love them</li></ul>
    <pre><code>cat.feed(&quot;fish&quot;);\n  cat.pet();</code></pre>
    <table><tr><td>Age</td><td>3</td></tr></table>
    <p>Read <a href="/more?page=2#x">more here</a> or <a href="https://other.example/x">elsewhere</a> or <a href="javascript:void(0)">nothing</a> or <a href="mailto:a@b.c">mail</a>.</p></article>
    <aside>Buy things</aside><footer>© nobody</footer><script>track()</script></body></html>`;

  it('keeps the content, drops the furniture, and decodes entities', () => {
    const { title, text, links } = extractReadable(article, 'https://example.com/cats/');
    assert.equal(title, 'Cats & dogs');
    assert.match(text, /^# All about cats/);
    assert.match(text, /Cats are small — furry & fast\./);
    assert.match(text, /## Care\n\n- Feed them\n- Love them/);
    assert.match(text, /```\ncat\.feed\("fish"\);\n {2}cat\.pet\(\);\n```/);
    assert.match(text, /Age \| 3/);
    for (const gone of ['var x', 'track()', 'Buy things', 'nobody', 'Home']) assert.ok(!text.includes(gone), gone);
    assert.deepEqual(links.map(link => link.url), ['https://example.com/more?page=2', 'https://other.example/x']);
  });

  it('copes with pages without an article, odd markup and numeric entities', () => {
    const { text } = extractReadable('<body><div>One &#65; &#x42; &#0; &bogus;</div><br><div>Two<p>Three', 'https://x.example/');
    assert.equal(text, 'One A B &#0; &bogus;\n\nTwo\nThree');
    assert.equal(extractReadable('', 'https://x.example/').text, '');
  });

  it('can tell a page that only fills itself in with scripts', () => {
    const shell = '<html><body><div id="root"></div><script src="/app.js"></script></body></html>';
    assert.equal(needsRendering(shell, extractReadable(shell, 'https://x.example/').text), true);
    assert.equal(needsRendering(article, extractReadable(article, 'https://x.example/').text), false);
  });
});
