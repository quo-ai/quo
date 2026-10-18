'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const { AgentError, IGNORED_DIRS, resolveInside } = require('../safety');
const { LIMITS, integer, sizeLabel } = require('./limits');


/** Lists a folder, optionally a few levels down. */
async function listDirectory(ctx, { path: input = '.', depth } = {}) {
  const { absolute, relative } = resolveInside(ctx.rootReal, input);
  const stat = await fsp.stat(absolute);
  if (!stat.isDirectory()) throw new AgentError('not_directory', `${relative} is a file, not a folder. Use read_file.`);
  const levels = integer(depth, 1, 1, 3);
  const lines = [];
  let count = 0;
  let cut = false;

  async function walk(directory, prefix, level) {
    const entries = (await fsp.readdir(directory, { withFileTypes: true })).sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (count >= LIMITS.listEntries) {
        cut = true;
        return;
      }
      count++;
      const name = entry.name;
      if (entry.isDirectory()) {
        const skipped = IGNORED_DIRS.has(name);
        lines.push(`${prefix}${name}/${skipped ? ' (skipped: dependencies or build output)' : ''}`);
        if (!skipped && level < levels) await walk(path.join(directory, name), `${prefix}  `, level + 1);
      } else if (entry.isSymbolicLink()) {
        lines.push(`${prefix}${name} (link)`);
      } else {
        const size = await fsp.stat(path.join(directory, name)).then(s => s.size, () => 0);
        lines.push(`${prefix}${name} (${sizeLabel(size)})`);
      }
    }
  }
  await walk(absolute, '', 1);
  const head = `${relative === '.' ? 'Project folder' : relative}${relative.endsWith('/') ? '' : '/'}`;
  const body = lines.length ? lines.join('\n') : '(empty)';
  return {
    text: `${head}\n${body}${cut ? `\n… [more than ${LIMITS.listEntries} entries; list a subfolder]` : ''}`,
    display: { kind: 'list', path: relative, entries: count },
  };
}

module.exports = { listDirectory };
