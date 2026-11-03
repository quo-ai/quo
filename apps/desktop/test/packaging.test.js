'use strict';

// Every file electron-builder.yml names under build/ must be in the repository: CI builds from a clean checkout, and a
// file that exists only on one computer (build/ is ignored but for its exceptions) breaks the release there.

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { it } = require('node:test');

it('keeps in git every build/ file the packaging config uses', () => {
  const root = path.join(__dirname, '..');
  const config = fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8');
  const named = [...new Set([...config.matchAll(/(?<![\w/])build\/[\w.-]+\.\w+/g)].map(match => match[0]))];
  assert.ok(named.includes('build/installer-notice.txt'));
  const tracked = execFileSync('git', ['ls-files', '--', ...named], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
  assert.deepEqual(named.filter(file => !tracked.includes(file)), []);
});

it('ships the document reader outside the asar with only what it loads, and leaves pdf.js’s extras out', () => {
  const root = path.join(__dirname, '..');
  const config = fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8');
  // The reader runs under Node's permission model and loads real files (src/agent/files/documents.js).
  for (const unpacked of ['src/agent/files/extract-worker.mjs', 'node_modules/pdfjs-dist/**', 'node_modules/fflate/**']) assert.ok(config.includes(`  - ${unpacked}`), unpacked);
  assert.ok(config.includes('"!node_modules/@napi-rs/**"'), 'the optional canvas package stays out');
  assert.ok(fs.existsSync(path.join(root, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs')), 'the text build of pdf.js is there');
});
