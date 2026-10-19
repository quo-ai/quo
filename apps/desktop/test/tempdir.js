'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** A new empty folder under the system's temporary folder (by its real path), removed when the test file finishes. */
const made = [];
function tempDir(prefix) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  made.push(dir);
  return dir;
}

process.on('exit', () => {
  for (const dir of made) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Still in use or already gone: the system's own clean-up takes it.
    }
  }
});

module.exports = { tempDir };
