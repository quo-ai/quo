'use strict';

const crypto = require('node:crypto');

/** Limits and small helpers shared by the file tools. */

const LIMITS = {
  maxFileBytes: 2 * 1024 * 1024,
  maxWriteBytes: 1024 * 1024,
  readLines: 400,
  outputChars: 60_000,
  lineChars: 500,
  listEntries: 300,
  findResults: 200,
  searchResults: 100,
  searchFiles: 20_000,
  searchBudgetMs: 10_000,
  regexBudgetMs: 400,
  patternChars: 300,
};

const sha = text => crypto.createHash('sha256').update(text).digest('hex');
const integer = (value, fallback, min, max) => (Number.isFinite(Number(value)) && value !== null && value !== '' ? Math.min(max, Math.max(min, Math.trunc(Number(value)))) : fallback);
const clip = (line, max = LIMITS.lineChars) => (line.length > max ? `${line.slice(0, max)}… [line cut]` : line);
const sizeLabel = bytes => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} B`);

function limitOutput(text) {
  if (text.length <= LIMITS.outputChars) return text;
  return `${text.slice(0, LIMITS.outputChars)}\n… [output cut at ${LIMITS.outputChars.toLocaleString('en-US')} characters. Ask for a smaller range or a narrower search.]`;
}

module.exports = { LIMITS, sha, integer, clip, sizeLabel, limitOutput };
