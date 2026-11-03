'use strict';

const fsp = require('node:fs/promises');
const { AgentError, isSecretPath, looksBinary, redactSecrets, resolveInside } = require('../safety');
const { LIMITS, clip, integer, limitOf, limitOutput, sha, sizeLabel } = require('./limits');
const { documentKind, reader } = require('./documents');


/** Reads part of a text file, with line numbers. */
async function readFile(ctx, { path: input, start_line: startLine, end_line: endLine } = {}) {
  if (!input) throw new AgentError('bad_args', 'read_file needs a path.');
  const { absolute, relative } = resolveInside(ctx.rootReal, input);
  if (isSecretPath(relative)) throw new AgentError('secret', `${relative} looks like a secrets file (keys, credentials or .env), so Quo doesn’t read it.`);
  const stat = await fsp.stat(absolute);
  if (stat.isDirectory()) throw new AgentError('not_file', `${relative} is a folder. Use list_directory.`);
  // A PDF, Word, PowerPoint, Excel or OpenDocument file is read as its text (documents.js), paged like any other file.
  const document = documentKind(relative);
  if (!document && stat.size > LIMITS.maxFileBytes) throw new AgentError('too_large', `${relative} is ${sizeLabel(stat.size)}, too large to read. Search inside it instead.`);
  let text;
  if (document) text = await reader.text(absolute, relative);
  else {
    const buffer = await fsp.readFile(absolute);
    if (looksBinary(buffer)) throw new AgentError('binary', `${relative} is a binary file.`);
    text = buffer.toString('utf8');
  }
  if (document && !text.replace(/Page \d+|Slide \d+|Sheet: .*/g, '').trim()) throw new AgentError('no_text', `${relative} has no text in it. If it is scanned, it is only pictures of pages.`);
  const lines = text.split(/\r?\n/);
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  const page = limitOf(ctx, 'readLines');
  const start = integer(startLine, 1, 1, Math.max(1, lines.length));
  const end = Math.min(lines.length, integer(endLine, start + page - 1, start, start + page - 1));
  const width = String(end).length;
  const body = lines.slice(start - 1, end).map((line, index) => `${String(start + index).padStart(width)}\t${clip(line)}`).join('\n');
  if (!document) ctx.reads.set(absolute, sha(text)); // a document can't be edited, so its text isn't a version to check edits against
  const more = end < lines.length ? `\n… [${lines.length - end} more lines. Read on with start_line=${end + 1}.]` : '';
  const from = document ? `, the text of the ${document === 'odf' ? 'OpenDocument' : document.toUpperCase()} file` : '';
  return {
    text: limitOutput(redactSecrets(`${relative} (lines ${start}-${end} of ${lines.length}${from})\n${body}${more}`), ctx.outputChars),
    display: { kind: 'read', path: relative, from: start, to: end, total: lines.length, ...(document ? { document } : {}) },
  };
}

module.exports = { readFile };
