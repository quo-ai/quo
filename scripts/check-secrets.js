#!/usr/bin/env node
'use strict';

// Fails if the repository contains something that must never be public: secrets
// files, credentials, keys, tokens, a personal email address or a local path.
//
//   node scripts/check-secrets.js              checks every tracked file as it is now
//   node scripts/check-secrets.js --history    also checks every file ever committed (CI does this)
//   node scripts/check-secrets.js --staged     checks only what is staged (the pre-commit hook does this)
//
// It never prints what it found, only where and which rule, so its output is safe to
// paste into an issue or leave in a CI log. Test fixtures build fake secrets at run
// time ('gh' + 'p_' + …) so this script can stay strict with no exceptions for tests.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const MAX_BYTES = 1024 * 1024;

// Files that must not be committed, by name. (`.example` files are fine: they hold placeholders.)
const BLOCKED_NAMES = [
  [/(^|\/)\.env(\.(?!example$|sample$|template$)[^/]*)?$/i, 'an .env file'],
  [/\.(pem|key|p8|p12|pfx|jks|keystore|ppk|mobileprovision|tfstate)$/i, 'a key, certificate or keystore'],
  [/(^|\/)(id_rsa|id_dsa|id_ecdsa|id_ed25519)$/i, 'an SSH private key'],
  [/(^|\/)\.(netrc|git-credentials)$/i, 'a credentials file'],
  [/(^|\/)\.(aws|ssh)\//i, 'a credentials folder'],
  [/(^|\/)\.vercel\//i, 'a Vercel project link'],
  [/(^|\/)(google-services\.json|GoogleService-Info\.plist)$/i, 'a Firebase config'],
  [/(^|\/)signing\.properties$/i, 'Android signing credentials'],
  [/(^|\/)(credentials|secrets)\.(json|ya?ml)$/i, 'a credentials file'],
  [/(^|\/)service-account[^/]*\.json$/i, 'a service account key'],
];

// The standard Android debug key (password "android", the same in every React Native project). Not a secret.
const ALLOWED_FILES = new Set(['apps/mobile/android/app/debug.keystore']);

// Secret formats, matched in file contents.
const SECRET_PATTERNS = [
  [/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/, 'a private key'],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/, 'an AWS access key'],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/, 'a GitHub token'],
  [/\bsk-(?:ant-|or-v1-|proj-)?[A-Za-z0-9_-]{32,}\b/, 'an API key (OpenAI, Anthropic or OpenRouter)'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/, 'a Slack token'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, 'a Google API key'],
  [/\b(?:pdl_|apikey_)[A-Za-z0-9_]{20,}/, 'a Paddle key'],
  [/\bre_[A-Za-z0-9]{24,}\b/, 'a Resend key'],
  [/\b(?:vercel_|vcp_)[A-Za-z0-9]{20,}/, 'a Vercel token'],
  [/postgres(?:ql)?:\/\/[^:\s/@]+:[^@\s]{6,}@/i, 'a database URL with a password'],
  [/\b(?:api[_-]?key|secret|token|passwd|password)\b["']?\s*[:=]\s*["'](?=[A-Za-z0-9/+_-]*\d)[A-Za-z0-9/+_-]{24,}["']/i, 'a hard-coded secret'],
];

// Personal traces: a home folder with a real name in it, or an email address that isn't one of ours.
const PATH_PATTERN = /(?:\/home\/|\/Users\/|[A-Za-z]:\\+Users\\+)(?!(?:user|runner|node|app|dev|me|you|name|username|your-?name|<[^>]*>|\$|\{|\*|runneradmin|%)\b)[A-Za-z][\w.-]{2,}/;
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const OUR_EMAILS = new Set(['astralabsltd@gmail.com']);
// Placeholders and our own sending domain (quoai.app is the default sender until the real domain is set).
const HARMLESS_EMAIL_DOMAINS = /(^|\.)(example\.(com|org|net)|users\.noreply\.github\.com|localhost|quoai\.app)$/i;
// Lockfiles list package authors' emails, and aren't worth reading for the rest.
const SKIP_CONTENT = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$|\.(png|jpe?g|gif|webp|ico|icns|zip|gz|woff2?|ttf|pdf|bin|hbc|gguf|mp3|wav|mp4|svg)$/i;

// Findings in old commits that were looked at and are not real: the fake keys one test used to spell out in full
// (they are assembled at run time now). History can't be rewritten, so they're listed here, by file and rule.
const REVIEWED_IN_HISTORY = [
  ['apps/desktop/test/agent.test.js', 'a private key', 'a made-up key used to test redaction'],
  ['apps/desktop/test/agent.test.js', 'an AWS access key', 'a made-up key used to test redaction'],
  ['apps/desktop/test/agent.test.js', 'an email address that isn’t ours', 'a made-up git remote used to test a zip'],
];

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/** Why a file name is not allowed, or null. */
function blockedName(file) {
  if (ALLOWED_FILES.has(file)) return null;
  return BLOCKED_NAMES.find(([pattern]) => pattern.test(file))?.[1] ?? null;
}

/** What is wrong inside a file's text: [{ line, rule }]. Never includes the text itself. */
function scanText(text, file = '') {
  if (SKIP_CONTENT.test(file) && !/package-lock/.test(file)) return [];
  const found = [];
  const lockfile = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/.test(file);
  if (!lockfile) {
    for (const [pattern, rule] of SECRET_PATTERNS) {
      const match = pattern.exec(text);
      if (match) found.push({ line: lineOf(text, match.index), rule });
    }
    const home = PATH_PATTERN.exec(text);
    if (home) found.push({ line: lineOf(text, home.index), rule: 'a local path with a personal name in it' });
    for (const match of text.matchAll(EMAIL_PATTERN)) {
      const email = match[0].toLowerCase();
      const domain = email.split('@')[1];
      if (!OUR_EMAILS.has(email) && !HARMLESS_EMAIL_DOMAINS.test(domain)) found.push({ line: lineOf(text, match.index), rule: 'an email address that isn’t ours' });
    }
  }
  return found;
}

// The repository being checked: this one, or (in tests) a throwaway one.
let repo = process.cwd();

const git = (args, options = {}) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...options });

function trackedFiles(staged) {
  return git(staged ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'] : ['ls-files', '-z']).split('\0').filter(Boolean);
}

function readDisk(file) {
  try {
    const buffer = fs.readFileSync(path.join(repo, file));
    return buffer.length > MAX_BYTES || buffer.subarray(0, 8192).includes(0) ? null : buffer.toString('utf8');
  } catch {
    return null; // deleted in the working tree
  }
}

function readBlob(spec) {
  try {
    const buffer = execFileSync('git', ['show', spec], { cwd: repo, maxBuffer: 256 * 1024 * 1024 });
    if (buffer.length > MAX_BYTES || buffer.subarray(0, 8192).includes(0)) return null;
    return buffer.toString('utf8');
  } catch {
    return null;
  }
}

function check({ history = false, staged = false, cwd = process.cwd() } = {}) {
  repo = cwd;
  const problems = [];
  const seen = new Set();
  const examine = (file, text, where) => {
    const name = blockedName(file);
    if (name) problems.push(`${where}: ${file} is ${name}`);
    if (text !== null) {
      for (const { line, rule } of scanText(text, file)) {
        if (where === 'history' && REVIEWED_IN_HISTORY.some(([f, r]) => f === file && r === rule)) continue;
        problems.push(`${where}: ${file}:${line} has ${rule}`);
      }
    }
  };

  for (const file of trackedFiles(staged)) examine(file, staged ? readBlob(`:${file}`) : readDisk(file), staged ? 'staged' : 'now');

  if (history) {
    // Every version of every file that was ever committed, once each: `--raw -z` gives the blob id, then the path.
    const raw = git(['log', '--all', '--raw', '--no-abbrev', '--diff-filter=AM', '--format=', '-z']).split('\0');
    for (let i = 0; i < raw.length; i++) {
      const meta = /^:\d+ \d+ [0-9a-f]+ ([0-9a-f]{40}) [AM]/.exec(raw[i]);
      if (!meta) continue;
      const file = raw[++i];
      const key = `${meta[1]}:${file}`;
      if (!file || seen.has(key)) continue;
      seen.add(key);
      examine(file, readBlob(meta[1]), 'history');
    }
  }
  return [...new Set(problems)];
}

if (require.main === module) {
  process.chdir(path.join(__dirname, '..'));
  const problems = check({ history: process.argv.includes('--history'), staged: process.argv.includes('--staged') });
  if (problems.length) {
    console.error(`Found ${problems.length} thing${problems.length === 1 ? '' : 's'} that must not be committed (what was found is not printed):\n`);
    for (const problem of problems.slice(0, 50)) console.error(`  ${problem}`);
    console.error('\nRemove it, move it out of the repository, and if it was a real secret, treat it as leaked and replace it.');
    process.exit(1);
  }
  console.log('No secrets, credentials or personal traces found.');
}

module.exports = { blockedName, scanText, check };
