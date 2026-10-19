'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { describe, it } = require('node:test');
const { windowIcon } = require('../src/appIcon');
const { tempDir } = require('./tempdir');

describe('the window icon', () => {
  it('on Linux is the app icon, from the source tree in development and from resources when packaged', () => {
    assert.equal(windowIcon({ platform: 'linux' }), path.join(__dirname, '..', 'build', 'icon.png'));
    const resources = tempDir('quo-icon-');
    assert.equal(windowIcon({ platform: 'linux', packaged: true, resourcesPath: resources }), undefined, 'a missing file is left out, not passed on');
    require('node:fs').copyFileSync(path.join(__dirname, '..', 'build', 'icon.png'), path.join(resources, 'icon.png'));
    assert.equal(windowIcon({ platform: 'linux', packaged: true, resourcesPath: resources }), path.join(resources, 'icon.png'));
  });

  it('is left to the app bundle on macOS and the .exe on Windows', () => {
    for (const platform of ['darwin', 'win32']) assert.equal(windowIcon({ platform }), undefined);
  });

  it('is packaged for Linux where the code looks for it', () => {
    const config = require('node:fs').readFileSync(path.join(__dirname, '..', 'electron-builder.yml'), 'utf8');
    const linux = config.slice(config.indexOf('\nlinux:'), config.indexOf('\nappImage:'));
    assert.match(linux, /- from: build\/icon\.png\s+to: icon\.png/);
  });
});
