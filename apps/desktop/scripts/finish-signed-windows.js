'use strict';

// After SignPath Foundation signs the Windows installer (.github/workflows/desktop-release.yml): put the signed file in
// place and make latest.yml describe it. electron-updater checks an update's SHA-512 and size against latest.yml, and
// signing changes the file. The block map for smaller downloads belongs to the unsigned file, so it goes: updates then
// download the whole installer.
//   node scripts/finish-signed-windows.js <signed installer> <dist folder>

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const NAME = 'Quo-windows-x64-setup.exe';

/** latest.yml with the signed installer's SHA-512 and size, and without the block map's size. */
function describeSigned(text, sha512, size) {
  return text
    .replace(/^(\s*(?:- )?)sha512: .+$/gm, `$1sha512: ${sha512}`)
    .replace(/^(\s*)size: \d+$/gm, `$1size: ${size}`)
    .replace(/^\s*blockMapSize: \d+\r?\n/gm, '');
}

function finish(signed, dist) {
  const target = path.join(dist, NAME);
  fs.copyFileSync(signed, target);
  const bytes = fs.readFileSync(target);
  const sha512 = crypto.createHash('sha512').update(bytes).digest('base64');
  const yml = path.join(dist, 'latest.yml');
  fs.writeFileSync(yml, describeSigned(fs.readFileSync(yml, 'utf8'), sha512, bytes.length));
  fs.rmSync(`${target}.blockmap`, { force: true });
  console.log(`latest.yml describes the signed installer: ${bytes.length} bytes`);
}

if (require.main === module) {
  const [signed, dist] = process.argv.slice(2);
  if (!signed || !dist) throw new Error('Usage: finish-signed-windows.js <signed installer> <dist folder>');
  finish(signed, dist);
}

module.exports = { describeSigned, finish };
