'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { tempDir } = require('./tempdir');
const { describeSigned, finish } = require('../scripts/finish-signed-windows');

const LATEST = `version: 1.5.1
files:
  - url: Quo-windows-x64-setup.exe
    sha512: OLDHASH==
    size: 100
    blockMapSize: 2000
path: Quo-windows-x64-setup.exe
sha512: OLDHASH==
releaseDate: '2026-11-03T00:00:00.000Z'
`;

test('latest.yml is made to describe the signed installer, without the unsigned file’s block map', () => {
  const text = describeSigned(LATEST, 'NEW+HASH/==', 123);
  assert.equal(text, LATEST.replace(/OLDHASH==/g, 'NEW+HASH/==').replace('size: 100', 'size: 123').replace('    blockMapSize: 2000\n', ''));
});

test('the signed file takes the installer’s place, and the hash is the signed file’s', () => {
  const dist = tempDir('quo-finish-');
  const signed = path.join(tempDir('quo-signed-'), 'Quo-windows-x64-setup.exe');
  fs.writeFileSync(signed, 'signed installer');
  fs.writeFileSync(path.join(dist, 'Quo-windows-x64-setup.exe'), 'unsigned installer');
  fs.writeFileSync(path.join(dist, 'Quo-windows-x64-setup.exe.blockmap'), 'old');
  fs.writeFileSync(path.join(dist, 'latest.yml'), LATEST);
  const log = console.log;
  console.log = () => {};
  try {
    finish(signed, dist);
  } finally {
    console.log = log;
  }
  assert.equal(fs.readFileSync(path.join(dist, 'Quo-windows-x64-setup.exe'), 'utf8'), 'signed installer');
  assert.equal(fs.existsSync(path.join(dist, 'Quo-windows-x64-setup.exe.blockmap')), false);
  const hash = crypto.createHash('sha512').update('signed installer').digest('base64');
  const yml = fs.readFileSync(path.join(dist, 'latest.yml'), 'utf8');
  assert.equal(yml.split(`sha512: ${hash}`).length - 1, 2);
  assert.match(yml, /size: 16\n/);
});
