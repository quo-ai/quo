'use strict';

const fsp = require('node:fs/promises');
const vm = require('node:vm');
const { AgentError, looksBinary, redactSecrets, resolveInside } = require('../safety');
const { globToRegExp, walkFiles } = require('./glob');
const { LIMITS, clip, integer, limitOf, limitOutput } = require('./limits');


/**
 * Searches file contents. The pattern is plain text unless `regex` is set; a regex
 * runs in a sandboxed context with a time limit, so a pattern that backtracks
 * forever is cut off instead of freezing the app.
 */
async function searchText(ctx, args = {}) {
  const { pattern, path: input = '.', glob, regex = false, case_sensitive: caseSensitive = false, max_results: maxResults } = args;
  if (!pattern) throw new AgentError('bad_args', 'search_text needs a pattern.');
  if (String(pattern).length > LIMITS.patternChars) throw new AgentError('bad_args', 'That pattern is too long.');
  const { absolute } = resolveInside(ctx.rootReal, input);
  const limit = integer(maxResults, Math.min(50, limitOf(ctx, 'searchResults')), 1, limitOf(ctx, 'searchResults'));
  const globber = glob ? globToRegExp(glob) : null;
  const flags = caseSensitive ? '' : 'i';
  let source = String(pattern);
  if (regex) {
    try {
      new RegExp(source, flags);
    } catch {
      throw new AgentError('bad_pattern', 'That isn’t a valid regular expression.');
    }
  } else source = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const sandbox = vm.createContext({ source, flags, text: '', max: limit });
  const script = new vm.Script(`(() => {
    const re = new RegExp(source, flags);
    const hits = [];
    const lines = text.split(/\\r?\\n/);
    for (let i = 0; i < lines.length && hits.length < max; i++) {
      if (lines[i].length <= 2000 && re.test(lines[i])) hits.push(i);
    }
    return { hits, lines: lines.length };
  })()`);

  const results = [];
  let files = 0;
  let scanned = 0;
  let stopped = null;
  const started = Date.now();
  for await (const file of walkFiles(ctx.rootReal, absolute)) {
    if (globber && !globber.test(file.relative)) continue;
    if (++scanned > LIMITS.searchFiles) {
      stopped = 'too many files';
      break;
    }
    if (Date.now() - started > LIMITS.searchBudgetMs) {
      stopped = 'it took too long';
      break;
    }
    let buffer;
    try {
      const stat = await fsp.stat(file.absolute);
      if (stat.size > LIMITS.maxFileBytes) continue;
      buffer = await fsp.readFile(file.absolute);
    } catch {
      continue;
    }
    if (looksBinary(buffer)) continue;
    const text = buffer.toString('utf8');
    sandbox.text = text;
    let found;
    try {
      found = script.runInContext(sandbox, { timeout: LIMITS.regexBudgetMs });
    } catch (error) {
      if (error?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') throw new AgentError('slow_pattern', 'That pattern is too slow to run. Try a simpler one.');
      throw error;
    }
    if (found.hits.length === 0) continue;
    files++;
    const lines = text.split(/\r?\n/);
    for (const index of found.hits) {
      results.push(`${file.relative}:${index + 1}: ${clip(lines[index].trim(), 300)}`);
      if (results.length >= limit) break;
    }
    if (results.length >= limit) {
      stopped = `reached ${limit} results`;
      break;
    }
  }
  const text = results.length
    ? `${results.join('\n')}${stopped ? `\n… [stopped: ${stopped}. Narrow the search with path or glob.]` : ''}`
    : `No matches for ${pattern}.${stopped ? ` (Stopped: ${stopped}.)` : ''}`;
  return { text: limitOutput(redactSecrets(text), ctx.outputChars), display: { kind: 'search', pattern, matches: results.length, files } };
}

module.exports = { searchText };
