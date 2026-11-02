'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tempDir } = require('./tempdir');
const { readUpdateChecks, writeUpdateChecks } = require('../src/updater');

test('update checks are on until the person turns them off, and a damaged setting means on', () => {
  const dir = tempDir('quo-updates-');
  assert.equal(readUpdateChecks(dir), true);
  writeUpdateChecks(false, dir);
  assert.equal(readUpdateChecks(dir), false);
  writeUpdateChecks(true, dir);
  assert.equal(readUpdateChecks(dir), true);
  fs.writeFileSync(path.join(dir, 'updates.json'), '{not json');
  assert.equal(readUpdateChecks(dir), true);
});
