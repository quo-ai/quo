'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tempDir } = require('./tempdir');
const { hasDeveloperId, readUpdateChecks, rememberTold, toldAbout, writeUpdateChecks } = require('../src/updater');

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

test('a Mac app updates itself only with a Developer ID signature; ad-hoc and unsigned ones are told instead', () => {
  assert.equal(hasDeveloperId('Executable=/Applications/Quo.app/Contents/MacOS/Quo\nAuthority=Developer ID Application: Astra Labs Ltd (ABCDE12345)\nAuthority=Developer ID Certification Authority\nTeamIdentifier=ABCDE12345'), true);
  assert.equal(hasDeveloperId('Executable=/Applications/Quo.app/Contents/MacOS/Quo\nSignature=adhoc\nTeamIdentifier=not set'), false);
  assert.equal(hasDeveloperId('Authority=Apple Development: someone (X)'), false);
  assert.equal(hasDeveloperId('code object is not signed at all'), false);
  assert.equal(hasDeveloperId(undefined), false);
});

test('a new version is told about once, and the update switch is kept alongside', () => {
  const dir = tempDir('quo-updates-told-');
  writeUpdateChecks(false, dir);
  assert.equal(toldAbout(dir), null);
  rememberTold('1.6.0', dir);
  assert.equal(toldAbout(dir), '1.6.0');
  assert.equal(readUpdateChecks(dir), false);
  writeUpdateChecks(true, dir);
  assert.equal(toldAbout(dir), '1.6.0');
});
