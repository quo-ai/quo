'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { tempDir } = require('../tempdir');

const temp = () => tempDir('quo-agent-');
const write = (root, relative, content) => {
  const target = path.join(root, ...relative.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
};
const rejects = (promise, code) => assert.rejects(promise, error => error.code === code, `expected ${code}`);
const throwsCode = (fn, code) => assert.throws(fn, error => error.code === code, `expected ${code}`);
const ctxFor = root => ({ rootReal: root, reads: new Map() });
const node = code => `"${process.execPath}" -e "${code}"`;

function trySymlink(target, link) {
  try {
    fs.symlinkSync(target, link);
    return true;
  } catch {
    return false; // Windows without the privilege
  }
}

module.exports = { temp, write, rejects, throwsCode, ctxFor, node, trySymlink };
