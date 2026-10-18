'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { guardedLookup, isPublicAddress, normalizeUrl, parseWebUrl } = require('../../src/web/guard');
const { WebSessions } = require('../../src/web/sessions');

const blocked = fn => assert.throws(fn, error => error.code === 'blocked' || error.code === 'bad_url');

describe('which addresses may be opened', () => {
  it('knows public addresses from the ones inside', () => {
    for (const address of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111', '::ffff:8.8.8.8']) assert.equal(isPublicAddress(address), true, address);
    for (const address of ['127.0.0.1', '127.1.2.3', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255',
      '::1', '::', 'fe80::1', 'fe80::1%eth0', 'fc00::1', 'fd12:3456::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a00:1', '::ffff:169.254.169.254', 'not an address', '']) {
      assert.equal(isPublicAddress(address), false, address);
    }
    assert.equal(isPublicAddress('172.32.0.1'), true);
  });

  it('takes ordinary web addresses, and drops the part after #', () => {
    assert.equal(parseWebUrl('https://example.com/a?b=1#top').href, 'https://example.com/a?b=1');
    assert.equal(parseWebUrl('  http://example.com ').hostname, 'example.com');
    assert.equal(parseWebUrl('https://[2606:4700:4700::1111]/').hostname, '[2606:4700:4700::1111]');
  });

  it('refuses this computer, private networks and metadata addresses, however they are written', () => {
    for (const address of ['http://127.0.0.1/', 'http://localhost:8080/', 'http://LOCALHOST/', 'http://app.localhost/', 'http://printer.local/', 'http://metadata.internal/', 'http://169.254.169.254/latest/meta-data/',
      'http://10.1.2.3/', 'http://192.168.0.1/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://[fe80::1]/', 'http://2130706433/', 'http://0x7f000001/', 'http://0177.0.0.1/', 'http://127.1/', 'http://0/']) {
      blocked(() => parseWebUrl(address));
    }
  });

  it('refuses other schemes, logins, empty addresses and absurd lengths', () => {
    for (const address of ['file:///etc/passwd', 'ftp://example.com', 'javascript:alert(1)', 'data:text/html,hi', 'https://user:pw@example.com/', 'https://:pw@example.com/', 'not a url', '', 'https://', `https://example.com/${'a'.repeat(2100)}`]) blocked(() => parseWebUrl(address));
  });

  it('lets tests open pages on this computer, and nothing else changes', () => {
    assert.equal(parseWebUrl('http://127.0.0.1:8080/x', { allowPrivate: true }).port, '8080');
    blocked(() => parseWebUrl('ftp://127.0.0.1/', { allowPrivate: true }));
  });

  it('refuses a name that points inside, at the moment of connecting', async () => {
    const result = await new Promise(resolve => guardedLookup('localhost', {}, error => resolve(error)));
    assert.equal(result.code, 'blocked');
    const all = await new Promise(resolve => guardedLookup('localhost', { all: true }, error => resolve(error)));
    assert.equal(all.code, 'blocked');
  });

  it('writes an address one way', () => {
    assert.equal(normalizeUrl('https://Example.com:443/a#x'), 'https://example.com/a');
    assert.equal(normalizeUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  });
});

describe('the addresses a conversation may open', () => {
  it('allows only what it was given, exactly, and forgets the oldest conversations', () => {
    const sessions = new WebSessions();
    sessions.allow('chat-one', ['https://example.com/a#section', 'https://example.com/b']);
    assert.equal(sessions.allows('chat-one', 'https://example.com/a'), true);
    assert.equal(sessions.allows('chat-one', 'https://EXAMPLE.com/a#other'), true);
    assert.equal(sessions.allows('chat-one', 'https://example.com/a?secret=conversation'), false);
    assert.equal(sessions.allows('chat-one', 'https://example.com/c'), false);
    assert.equal(sessions.allows('chat-two', 'https://example.com/a'), false);
    for (let i = 0; i < 20; i++) sessions.allow(`chat-${i + 10}`, ['https://example.com/x']);
    assert.equal(sessions.allows('chat-one', 'https://example.com/a'), false);
  });

  it('ignores ids that aren’t ids', () => {
    const sessions = new WebSessions();
    sessions.allow('', ['https://example.com/']);
    sessions.allow('has space', ['https://example.com/']);
    assert.equal(sessions.allows('', 'https://example.com/'), false);
  });
});
