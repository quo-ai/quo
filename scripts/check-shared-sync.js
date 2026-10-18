#!/usr/bin/env node
'use strict';

// Quo Sync's engine, wire format, merge rules and recovery-key code must behave
// identically in the web app and the phone app, so each has to be byte-for-byte
// the same file. apps/web/src/sync/ is the original; apps/mobile/services/sync/
// holds copies (the phone app can't import from outside its own folder: Metro
// and EAS only see apps/mobile).
//
//   node scripts/check-shared-sync.js          fails if a copy differs (CI runs this)
//   node scripts/check-shared-sync.js --fix    copies the originals over the phone app's

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const original = path.join(root, 'apps/web/src/sync');
const copy = path.join(root, 'apps/mobile/services/sync');
const SHARED = ['wire.ts', 'merge.ts', 'engine.ts', 'kinds.ts', 'recovery.ts', '__tests__/vectors.json'];
const fix = process.argv.includes('--fix');

let differing = 0;
for (const file of SHARED) {
  const from = path.join(original, file);
  const to = path.join(copy, file);
  const same = fs.existsSync(to) && fs.readFileSync(from).equals(fs.readFileSync(to));
  if (same) continue;
  if (fix) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    console.log(`copied ${file}`);
  } else {
    console.error(`apps/mobile/services/sync/${file} differs from apps/web/src/sync/${file}`);
    differing++;
  }
}
if (differing) {
  console.error('\nEdit the web app\'s file, then run: node scripts/check-shared-sync.js --fix');
  process.exit(1);
}
if (!fix) console.log(`The ${SHARED.length} shared sync files match.`);
