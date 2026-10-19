'use strict';

const { walkFiles } = require('./glob');
const { LIMITS } = require('./limits');
const { resolveInside } = require('../safety');

/**
 * Finds files by part of their name, for the @ picker in the chat bar: the closer the match to the file's own name, the
 * higher it comes (an exact name, a start, a part, a part of the path, then letters in order). Skips dependencies, build
 * output and secrets, like every other file tool.
 */

function score(file, query) {
  const lower = file.toLowerCase();
  const base = lower.slice(lower.lastIndexOf('/') + 1);
  if (!query) return (file.split('/').length - 1) * 10 + lower.length / 100;
  if (base === query) return 0;
  if (base.startsWith(query)) return 1 + base.length / 100;
  if (base.includes(query)) return 2 + base.indexOf(query) / 100;
  if (lower.includes(query)) return 3 + lower.indexOf(query) / 100;
  let next = 0;
  for (const char of lower) if (char === query[next]) next++;
  return next === query.length ? 4 + lower.length / 100 : null;
}

async function suggestFiles(ctx, rawQuery, { limit = 12, budgetMs = 1500 } = {}) {
  const query = String(rawQuery ?? '').trim().toLowerCase().slice(0, 100);
  const found = [];
  const started = Date.now();
  let scanned = 0;
  const { absolute } = resolveInside(ctx.rootReal, '.');
  for await (const file of walkFiles(ctx.rootReal, absolute)) {
    if (++scanned > LIMITS.searchFiles || Date.now() - started > budgetMs) break;
    const value = score(file.relative, query);
    if (value !== null) found.push({ file: file.relative, value });
  }
  return found.sort((a, b) => a.value - b.value || a.file.localeCompare(b.file)).slice(0, limit).map(entry => entry.file);
}

module.exports = { suggestFiles, score };
