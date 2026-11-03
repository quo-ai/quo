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
