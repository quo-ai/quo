#!/usr/bin/env node
'use strict';

// Keeps files small enough to read: no source file over 500 lines.
//
// Some files were already longer when this check was added. They are listed below with
// the length they had, and may only get shorter: a listed file that grows fails, and one
// that drops under the limit has to be taken off the list, so the list only ever shrinks.
//
//   node scripts/check-structure.js

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const LIMIT = 500;
const SOURCE = /\.(js|jsx|ts|tsx|mjs|cjs|css|py|sh)$/;
const SKIPPED = /(^|\/)(android|ios|node_modules|dist)\/|\.d\.ts$|^website\/(privacy|terms|support|brand|delete-account|404)\//;

// Lists of data (sample prompts, model tables) are long but have no logic to split.
const DATA = new Set(['apps/mobile/constants/suggested-prompts.ts']);

// Longer than the limit when this check was added: file -> its length then.
const KNOWN_LONG = {
  'apps/mobile/services/llm.ts': 1139,
  'apps/mobile/services/whisperService.ts': 939,
  'apps/mobile/contexts/ChatContext.tsx': 824,
  'apps/mobile/services/downloadService.ts': 797,
  'apps/mobile/services/analyticsService.ts': 750,
  'apps/mobile/services/recallService.ts': 636,
  'apps/mobile/contexts/chat/useModelLifecycle.ts': 614,
  'apps/mobile/components/UpgradeModal.tsx': 607,
  'apps/mobile/contexts/PremiumContext.tsx': 539,
  'apps/mobile/components/settings/ModelsSection.tsx': 512,
};

const countLines = text => (text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0));

/** Problems found in `lengths` (file -> line count). */
function check(lengths, { limit = LIMIT, known = KNOWN_LONG, data = DATA } = {}) {
  const problems = [];
  for (const [file, lines] of Object.entries(lengths)) {
    if (data.has(file)) continue;
    const allowed = known[file];
    if (allowed === undefined && lines > limit) problems.push(`${file} has ${lines} lines (the limit is ${limit}). Split it by what it does.`);
    else if (allowed !== undefined && lines > allowed) problems.push(`${file} grew from ${allowed} to ${lines} lines. It is already too long: move code out of it instead.`);
    else if (allowed !== undefined && lines <= limit) problems.push(`${file} is down to ${lines} lines, under the limit. Remove it from KNOWN_LONG in scripts/check-structure.js.`);
  }
  for (const file of Object.keys(known)) if (!(file in lengths)) problems.push(`${file} no longer exists. Remove it from KNOWN_LONG in scripts/check-structure.js.`);
  return problems;
}

function measure(root) {
  const listed = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0').filter(Boolean);
  const lengths = {};
  for (const file of listed) {
    if (!SOURCE.test(file) || SKIPPED.test(file)) continue;
    try {
      lengths[file] = countLines(fs.readFileSync(path.join(root, file), 'utf8'));
    } catch {
      // Deleted in the working tree.
    }
  }
  return lengths;
}

if (require.main === module) {
  const problems = check(measure(path.join(__dirname, '..')));
  if (problems.length) {
    console.error(problems.map(problem => `  ${problem}`).join('\n'));
    process.exit(1);
  }
  console.log(`Every source file is within ${LIMIT} lines (${Object.keys(KNOWN_LONG).length} older ones are held at their length).`);
}

module.exports = { check, countLines, KNOWN_LONG, LIMIT };
