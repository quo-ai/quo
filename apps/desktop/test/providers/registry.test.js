'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { BUILT_IN, allowed, cleanBaseUrl } = require('../../src/providers/registry');

describe('where keys may be sent', () => {
  it('only to https addresses, and only to the chat and model-list calls', () => {
    for (const [id, provider] of Object.entries(BUILT_IN)) assert.match(provider.baseUrl, /^https:\/\/[^/]+(\/[^/]+)*[^/]$/, id);
    assert.equal(allowed('openai', 'POST', '/chat/completions'), true);
    assert.equal(allowed('openai', 'GET', '/models'), true);
    assert.equal(allowed('anthropic', 'POST', '/messages'), true);
    assert.equal(allowed('anthropic', 'GET', '/models?limit=1000'), true);
  });

  it('and nothing else: other paths, wrong methods, extra segments, queries, traversal', () => {
    for (const [protocol, method, path] of [
      ['openai', 'GET', '/chat/completions'], ['openai', 'POST', '/models'], ['openai', 'POST', '/embeddings'], ['openai', 'POST', '/files'],
      ['openai', 'GET', '/models?limit=5'], ['openai', 'POST', '/chat/completions/'], ['openai', 'POST', '/chat/completions?x=1'], ['openai', 'POST', '//evil.com/chat/completions'],
      ['openai', 'POST', '/../chat/completions'], ['openai', 'POST', 'https://evil.com/chat/completions'], ['openai', 'DELETE', '/models'], ['openai', 'POST', '/messages'],
      ['anthropic', 'POST', '/chat/completions'], ['anthropic', 'GET', '/models?limit=abc'], ['anthropic', 'GET', '/models?limit=1000&x=1'], ['anthropic', 'GET', '/models/x'],
      ['mystery', 'POST', '/chat/completions'], ['openai', 'POST', ''], ['openai', undefined, undefined],
    ]) assert.equal(allowed(protocol, method, path), false, `${protocol} ${method} ${path}`);
  });

  it('accepts a custom address only over https, or http on this computer and local networks', () => {
    assert.equal(cleanBaseUrl('https://llm.example.com/v1/'), 'https://llm.example.com/v1');
    assert.equal(cleanBaseUrl('http://localhost:11434/v1'), 'http://localhost:11434/v1');
    assert.equal(cleanBaseUrl('http://192.168.1.2:8000'), 'http://192.168.1.2:8000');
    for (const bad of ['http://llm.example.com/v1', 'ftp://localhost', 'https://u:p@h/v1', 'https://h/v1?a=1', 'nonsense', '', null, undefined]) assert.equal(cleanBaseUrl(bad), null, String(bad));
  });
});
