'use strict';

const fsp = require('node:fs/promises');
const { AgentError, isSecretPath, looksBinary, redactSecrets, resolveInside } = require('../safety');
const { LIMITS, clip, integer, limitOutput, sha, sizeLabel } = require('./limits');


/** Reads part of a text file, with line numbers. */
async function readFile(ctx, { path: input, start_line: startLine, end_line: endLine } = {}) {
  if (!input) throw new AgentError('bad_args', 'read_file needs a path.');
  const { absolute, relative } = resolveInside(ctx.rootReal, input);
  if (isSecretPath(relative)) throw new AgentError('secret', `${relative} looks like a secrets file (keys, credentials or .env), so Quo doesn’t read it.`);
  const stat = await fsp.stat(absolute);
  if (stat.isDirectory()) throw new AgentError('not_file', `${relative} is a folder. Use list_directory.`);
  if (stat.size > LIMITS.maxFileBytes) throw new AgentError('too_large', `${relative} is ${sizeLabel(stat.size)}, too large to read. Search inside it instead.`);
  const buffer = await fsp.readFile(absolute);
  if (looksBinary(buffer)) throw new AgentError('binary', `${relative} is a binary file.`);
  const text = buffer.toString('utf8');
  const lines = text.split(/\r?\n/);
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  const start = integer(startLine, 1, 1, Math.max(1, lines.length));
  const end = Math.min(lines.length, integer(endLine, start + LIMITS.readLines - 1, start, start + LIMITS.readLines - 1));
  const width = String(end).length;
  const body = lines.slice(start - 1, end).map((line, index) => `${String(start + index).padStart(width)}\t${clip(line)}`).join('\n');
  ctx.reads.set(absolute, sha(text));
  const more = end < lines.length ? `\n… [${lines.length - end} more lines. Read on with start_line=${end + 1}.]` : '';
  return {
    text: limitOutput(redactSecrets(`${relative} (lines ${start}-${end} of ${lines.length})\n${body}${more}`)),
    display: { kind: 'read', path: relative, from: start, to: end, total: lines.length },
  };
}

module.exports = { readFile };
