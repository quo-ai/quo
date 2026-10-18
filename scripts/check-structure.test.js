'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { check, countLines } = require('./check-structure');

const options = { limit: 100, known: { 'old.ts': 300 }, data: new Set(['prompts.ts']) };

describe('file length check', () => {
  it('counts lines the way an editor does', () => {
    assert.equal(countLines(''), 0);
    assert.equal(countLines('a'), 1);
    assert.equal(countLines('a\n'), 1);
    assert.equal(countLines('a\nb\n'), 2);
    assert.equal(countLines('a\n\nb'), 3);
  });

  it('accepts files within the limit, and lists of data of any length', () => {
    assert.deepEqual(check({ 'a.ts': 100, 'b.ts': 3, 'prompts.ts': 5000, 'old.ts': 300 }, options), []);
  });

  it('refuses a new file over the limit', () => {
    const problems = check({ 'new.ts': 101, 'old.ts': 300 }, options);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /new\.ts has 101 lines/);
  });

  it('lets an old long file get shorter, but not longer', () => {
    assert.deepEqual(check({ 'old.ts': 250 }, options), []);
    assert.match(check({ 'old.ts': 301 }, options)[0], /grew from 300 to 301/);
  });

  it('asks for an old file to come off the list once it is under the limit, or gone', () => {
    assert.match(check({ 'old.ts': 90 }, options)[0], /Remove it from KNOWN_LONG/);
    assert.match(check({}, options)[0], /no longer exists/);
  });

  it('holds this repository to it', () => {
    const { execFileSync } = require('node:child_process');
    const output = execFileSync('node', [require('node:path').join(__dirname, 'check-structure.js')], { encoding: 'utf8' });
    assert.match(output, /Every source file is within 500 lines/);
  });
});
