'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { trusted } = require('../src/trust');

const from = url => ({ senderFrame: { url } });

describe('which pages may use the app’s bridges', () => {
  it('trusts only the app’s own pages', () => {
    assert.equal(trusted(from('app://quo/index.html')), true);
    assert.equal(trusted(from('app://quo/')), true);
  });

  it('trusts nothing else a window might show', () => {
    for (const url of ['https://quo/', 'https://example.com/', 'app://other/', 'app://quo.evil.com/', 'file:///etc/passwd', 'about:blank', 'javascript:alert(1)', '', 'not a url']) assert.equal(trusted(from(url)), false, url);
    assert.equal(trusted({}), false);
    assert.equal(trusted({ senderFrame: null }), false);
    assert.equal(trusted(undefined), false);
  });
});
