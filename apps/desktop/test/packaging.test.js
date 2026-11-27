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

it('keeps the Flatpak in step with the pinned engines, the app’s version and its own files', () => {
  const root = path.join(__dirname, '..');
  const read = file => fs.readFileSync(path.join(root, file), 'utf8');
  const manifest = read('flatpak/computer.quo.Quo.yml');
  const metainfo = read('flatpak/computer.quo.Quo.metainfo.xml');
  const desktop = read('flatpak/computer.quo.Quo.desktop');
  const lock = JSON.parse(read('engine.lock.json'));

  // The engines built from source are the releases engine.lock.json pins (apps/desktop/flatpak/README.md).
  assert.ok(manifest.includes(`/llama.cpp/archive/refs/tags/${lock.release}.tar.gz`), `llama.cpp ${lock.release}`);
  assert.ok(manifest.includes(`-DLLAMA_BUILD_NUMBER=${lock.release.replace(/^b/, '')} `), 'llama.cpp build number');
  const short = lock.images.release.split('-').at(-1);
  assert.match(manifest, new RegExp(`/stable-diffusion\\.cpp/archive/${short}[0-9a-f]{33}\\.tar\\.gz`), `stable-diffusion.cpp ${short}`);

  // Flathub shows the metainfo's releases: the version being built must be one of them.
  const { version } = JSON.parse(read('package.json'));
  assert.ok(metainfo.includes(`<release version="${version}"`), `the metainfo needs a <release version="${version}">`);

  // One app ID everywhere, and the launcher the desktop file starts.
  assert.match(manifest, /^id: computer\.quo\.Quo$/m);
  assert.match(manifest, /^command: quo$/m);
  assert.ok(metainfo.includes('<id>computer.quo.Quo</id>') && metainfo.includes('<launchable type="desktop-id">computer.quo.Quo.desktop</launchable>'));
  assert.match(desktop, /^Exec=quo %U$/m);
  assert.match(desktop, /^Icon=computer\.quo\.Quo$/m);
  assert.match(desktop, /^MimeType=x-scheme-handler\/quo;$/m);

  // The icon and screenshots it names are in git.
  const screenshots = [...metainfo.matchAll(/apps\/desktop\/flatpak\/screenshots\/[\w-]+\.png/g)].map(match => match[0].replace('apps/desktop/', ''));
  assert.equal(screenshots.length, 2);
  const named = ['../../website/assets/brand/quo-app-icon.svg', ...screenshots];
  assert.ok(manifest.includes('website/assets/brand/quo-app-icon.svg'));
  const tracked = execFileSync('git', ['ls-files', '--', ...named], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
  assert.equal(tracked.length, named.length, `not in git: ${named.join(', ')}`);
});
