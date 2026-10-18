'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const { MAX_CHARS, readInstructions } = require('../../src/agent/instructions');
const { temp, trySymlink, write } = require('./helpers');

describe('project notes', () => {
  it('reads AGENTS.md, or CLAUDE.md when there is no AGENTS.md', async () => {
    const root = temp();
    assert.equal(await readInstructions(root), null);
    write(root, 'CLAUDE.md', 'Use tabs.');
    assert.deepEqual(await readInstructions(root), { file: 'CLAUDE.md', text: 'Use tabs.' });
    write(root, 'AGENTS.md', 'Run npm test before finishing.\n');
    assert.deepEqual(await readInstructions(root), { file: 'AGENTS.md', text: 'Run npm test before finishing.' });
  });

  it('looks only in the top folder', async () => {
    const root = temp();
    write(root, 'docs/AGENTS.md', 'nested');
    assert.equal(await readInstructions(root), null);
  });

  it('ignores an empty file and takes secret formats out of the rest', async () => {
    const root = temp();
    write(root, 'AGENTS.md', '  \n');
    assert.equal(await readInstructions(root), null);
    write(root, 'AGENTS.md', `deploy with ${'gh'}${'p_'}${'a'.repeat(36)} please`);
    const notes = await readInstructions(root);
    assert.ok(!notes.text.includes('ghp_'));
    assert.match(notes.text, /\[token removed\]/);
  });

  it('cuts long notes, and doesn’t read huge or binary files', async () => {
    const root = temp();
    write(root, 'AGENTS.md', 'x'.repeat(MAX_CHARS * 3));
    const notes = await readInstructions(root);
    assert.ok(notes.text.length < MAX_CHARS + 100);
    assert.match(notes.text, /rest of AGENTS\.md is left out/);
    write(root, 'AGENTS.md', 'x'.repeat(100 * 1024));
    assert.equal(await readInstructions(root), null);
    write(root, 'AGENTS.md', Buffer.from([65, 0, 66]));
    assert.equal(await readInstructions(root), null);
  });

  it('won’t follow a link out of the project', async () => {
    const root = temp();
    const outside = temp();
    write(outside, 'private.md', 'not yours to read');
    if (!trySymlink(path.join(outside, 'private.md'), path.join(root, 'AGENTS.md'))) return;
    assert.equal(await readInstructions(root), null);
    assert.ok(fs.existsSync(path.join(root, 'AGENTS.md')));
  });
});
