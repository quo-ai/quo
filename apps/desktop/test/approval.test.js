'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { shapeRequest, normalizeChoice, LIMITS } = require('../src/approval/request');

const edit = { kind: 'edit', title: 'Edit a.js?', project: 'demo', rememberLabel: 'Allow edits', view: { kind: 'edit', action: 'edit', file: 'a.js', added: 2, removed: 1, diff: '-a\n+b' } };

describe('what the approval window is told', () => {
  it('keeps the shape of each kind and nothing else', () => {
    const shaped = shapeRequest({ ...edit, extra: '<script>', view: { ...edit.view, html: '<b>x</b>', onclick: 'x' } });
    assert.deepEqual(shaped, { kind: 'edit', title: 'Edit a.js?', project: 'demo', rememberLabel: 'Allow edits', view: { kind: 'edit', action: 'edit', file: 'a.js', added: 2, removed: 1, diff: '-a\n+b' } });
    assert.deepEqual(shapeRequest({ kind: 'command', title: 'Run?', view: { kind: 'command', command: 'npm test', background: true } }).view, { kind: 'command', command: 'npm test', background: true });
    const commit = shapeRequest({ kind: 'commit', title: 'Commit?', view: { kind: 'commit', branch: 'main', author: 'Pat', files: ['a', 'b'], message: 'Fix', credit: 'Co-Authored-By: Quo' } });
    assert.deepEqual(commit.view.files, ['a', 'b']);
    assert.equal(shapeRequest({ kind: 'read', title: 'Read?', view: { kind: 'read', folder: '/x' } }).view.folder, '/x');
  });

  it('clips what is long, and counts only sensible numbers', () => {
    const shaped = shapeRequest({ ...edit, title: 'x'.repeat(1000), view: { ...edit.view, diff: 'd'.repeat(100_000), added: -5, removed: Number.NaN } });
    assert.ok(shaped.title.length <= LIMITS.title + 1);
    assert.ok(shaped.view.diff.length <= LIMITS.diff + 1);
    assert.equal(shaped.view.added, 0);
    assert.equal(shaped.view.removed, 0);
    const many = shapeRequest({ kind: 'commit', title: 'c', view: { kind: 'commit', files: Array(500).fill('f') } });
    assert.equal(many.view.files.length, LIMITS.files);
  });

  it('turns away anything it cannot draw, so the plain dialog is used instead', () => {
    for (const bad of [null, 'x', {}, { kind: 'edit' }, { kind: 'rm -rf', title: 't', view: { kind: 'rm -rf' } }, { ...edit, view: { kind: 'command' } }, { ...edit, view: null }, { ...edit, title: 7 }]) assert.equal(shapeRequest(bad), null, JSON.stringify(bad));
  });

  it('only takes a text value for text, never an object that could carry markup or code', () => {
    const shaped = shapeRequest({ ...edit, view: { ...edit.view, file: { toString: () => '<img onerror=x>' }, diff: ['a'], action: 'delete everything' } });
    assert.equal(shaped.view.file, '');
    assert.equal(shaped.view.diff, '');
    assert.equal(shaped.view.action, 'edit');
  });
});

describe('what the window may answer', () => {
  it('allows once, allows for the session only when that was offered, and anything else is no', () => {
    assert.equal(normalizeChoice(edit, 'once'), 'once');
    assert.equal(normalizeChoice(edit, 'session'), 'session');
    assert.equal(normalizeChoice({ ...edit, rememberLabel: '' }, 'session'), 'deny', 'a commit never offers "for this session"');
    for (const choice of ['allow', 'yes', '', undefined, null, 1, { choice: 'once' }, 'ONCE', 'deny']) assert.equal(normalizeChoice(edit, choice), 'deny', String(choice));
  });
});
