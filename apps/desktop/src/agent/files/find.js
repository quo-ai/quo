'use strict';

const { AgentError, resolveInside } = require('../safety');
const { globToRegExp, walkFiles } = require('./glob');
const { LIMITS, limitOf } = require('./limits');


/** Finds files by name pattern. */
async function findFiles(ctx, { pattern, path: input = '.' } = {}) {
  if (!pattern) throw new AgentError('bad_args', 'find_files needs a pattern, like "**/*.ts".');
  if (String(pattern).length > LIMITS.patternChars) throw new AgentError('bad_args', 'That pattern is too long.');
  const { absolute, relative } = resolveInside(ctx.rootReal, input);
  const matcher = globToRegExp(pattern);
  const found = [];
  let scanned = 0;
  let cut = false;
  for await (const file of walkFiles(ctx.rootReal, absolute)) {
    if (++scanned > LIMITS.searchFiles) {
      cut = true;
      break;
    }
    if (matcher.test(file.relative)) {
      found.push(file.relative);
      if (found.length >= limitOf(ctx, 'findResults')) {
        cut = true;
        break;
      }
    }
  }
  return {
    text: found.length ? `${found.join('\n')}${cut ? `\n… [stopped at ${found.length}; narrow the pattern or folder]` : ''}` : `No files match ${pattern}${relative === '.' ? '' : ` under ${relative}`}.`,
    display: { kind: 'find', pattern, matches: found.length },
  };
}

module.exports = { findFiles };
