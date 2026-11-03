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

it('ships the document reader with pdf.js’s text build only', () => {
  const root = path.join(__dirname, '..');
  const config = fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8');
  // Read in a sandboxed window from the asar (src/agent/files/reader/), so nothing needs unpacking.
  assert.equal(/asarUnpack/.test(config), false);
  assert.ok(config.includes('"!node_modules/@napi-rs/**"'), 'the optional canvas package stays out');
  for (const file of ['src/agent/files/reader/reader.html', 'src/agent/files/reader/extract.mjs', 'node_modules/pdfjs-dist/legacy/build/pdf.mjs', 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', 'node_modules/fflate/esm/browser.js']) {
    assert.ok(fs.existsSync(path.join(root, file)), file);
  }
});
