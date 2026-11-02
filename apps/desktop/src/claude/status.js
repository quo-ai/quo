'use strict';

const { canCheck, listOf, rowsOf } = require('./catalog');
const { versionProblem } = require('./session');
const { loadSdk } = require('./sdk');

/**
 * Whether Claude Code is installed and signed in, and which models it offers. Starting it and reading what it reports
 * at start-up sends no message, so this uses none of the person's plan. The page is told how they're signed in (a
 * Claude plan, an API key, a cloud provider), never their email or organization.
 */

const STATUS_MS = 30_000;

function accountOf(account = {}) {
  const plan = typeof account.subscriptionType === 'string' ? account.subscriptionType.replace(/[^\w -]/g, '').slice(0, 24) : null;
  if (account.apiProvider && account.apiProvider !== 'firstParty') return { signedIn: true, kind: 'cloud', plan: null };
  if (account.apiKeySource) return { signedIn: true, kind: 'api_key', plan: null };
  // Newer versions report the plan and email of a Claude login and no token source; older ones say where the token came from.
  const claudeLogin = account.tokenSource ? account.tokenSource !== 'none' : Boolean(account.subscriptionType || account.email);
  return claudeLogin ? { signedIn: true, kind: 'subscription', plan } : { signedIn: false, kind: null, plan: null };
}

/** A Claude Code process that is started, reports in and is closed, sending nothing: its prompt never yields a message. */
async function openProbe(options, load = loadSdk) {
  const { query } = await load();
  let finish;
  const done = new Promise(resolve => {
    finish = resolve;
  });
  const session = query({ prompt: (async function* idle() { await done; })(), options });
  return { session, close: () => { finish(); session.close(); } };
}

/**
 * The status, with the full model list when `catalog` has it for this version and sign-in. Otherwise the list is
 * Claude Code's own rows, `checking` is set, and the catalog checks the specific versions in the background.
 */
async function checkClaude({ executable, options, load = loadSdk, catalog = null }) {
  if (!executable) return { installed: false };
  const { session, close } = await openProbe(options, load);
  try {
    const init = await Promise.race([
      session.initializationResult(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Claude Code didn’t start within 30 seconds.')), STATUS_MS).unref?.()),
    ]);
    const account = accountOf(init.account);
    const status = { installed: true, version: init.claude_code_version ?? null, problem: versionProblem(init.claude_code_version), ...account };
    if (!account.signedIn || status.problem) return { ...status, models: listOf(rowsOf(init), new Map()) };
    const key = `${status.version}|${account.kind}|${account.plan ?? ''}`;
    const known = catalog?.cached(key);
    if (known) return { ...status, models: known };
    const checking = Boolean(catalog && canCheck(init));
    if (checking) void catalog.check(key, () => openProbe(options, load)).catch(() => {});
    return { ...status, models: listOf(rowsOf(init), new Map()), checking };
  } catch (error) {
    return { installed: true, problem: `Claude Code couldn’t start: ${String(error?.message ?? error).slice(0, 200)}` };
  } finally {
    close();
  }
}

module.exports = { checkClaude, accountOf };
