'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { AgentError, redactSecrets } = require('./safety');
const { git } = require('./gitcmd');
const { checkHooks, hasHook, parseStatus } = require('./commit');

/**
 * The git_push tool: pushes the branch you are on to a remote the project already has, made by the app with fixed
 * arguments, never by a command the model wrote. It takes no arguments from the model at all, so it can't be pointed
 * at another remote, another branch or a force push.
 *
 *  - The remote is the branch's upstream, else `origin`, else the only remote there is: one already in the project's
 *    git config, shown in the approval window by its address (with any password in it taken out).
 *  - Only the current branch goes up, to the branch of the same name (or its upstream). A new branch gets its upstream set.
 *  - Never forced: when the remote has commits this branch doesn't, it refuses and says to pull first. Hooks run, and a
 *    hook that stops the push is reported for the model to fix, never skipped.
 *  - Every push asks, in its own window that lists the commits going up; there is no "for this session".
 *  - For a GitHub remote it gives a link to open a pull request (GitHub's own compare page), so no token is involved.
 *
 * A setting turns the tool off (Models & storage → Code); it is on by default.
 */

const MAX_LISTED = 30;
const PUSH_TIMEOUT_MS = 120_000;
const QUO_URL = 'https://quoai.vercel.app';

/** A remote's address for showing: any user name or password in it removed. */
function displayUrl(url) {
  const text = String(url ?? '').trim();
  try {
    const parsed = new URL(text);
    if (parsed.username || parsed.password) {
      parsed.username = '';
      parsed.password = '';
    }
    return redactSecrets(parsed.toString());
  } catch {
    return redactSecrets(text); // scp-like git@host:owner/repo.git, or a path
  }
}

/** owner/repo for a GitHub remote address, else null. */
function githubRepo(url) {
  const text = String(url ?? '').trim();
  const match = /^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|ssh:\/\/(?:[^@/]+@)?github\.com(?::\d+)?\/|(?:[\w.-]+@)?github\.com:)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(text);
  return match ? `${match[1]}/${match[2]}` : null;
}

/** GitHub's page for opening a pull request from `head` into `base`, with a line crediting Quo when that setting is on. */
function pullRequestUrl(repo, base, head, credit) {
  if (!repo || !base || !head || base === head) return null;
  const query = new URLSearchParams({ expand: '1' });
  if (credit) query.set('body', `\n\n---\nMade with [Quo](${QUO_URL})`);
  return `https://github.com/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}?${query}`;
}

const lines = output => output.split('\n').map(line => line.trim()).filter(Boolean);

/** Works out what a push would send and checks every rule, changing nothing. Throws AgentError to refuse. */
async function planPush({ rootReal, env = process.env, credit = true }) {
  if (!fs.existsSync(path.join(rootReal, '.git'))) throw new AgentError('no_repo', 'This project folder isn’t a git repository.');
  const head = await git(rootReal, ['symbolic-ref', '--quiet', '--short', 'HEAD'], env);
  const branch = head.stdout.trim();
  if (head.code !== 0 || !branch) throw new AgentError('detached', 'The project isn’t on a branch (a detached HEAD), so there is nothing to push. Ask the user which branch to use.');
  if ((await git(rootReal, ['check-ref-format', '--branch', branch], env)).code !== 0) throw new AgentError('bad_branch', 'The branch name isn’t one git can push.');

  const remotes = lines((await git(rootReal, ['remote'], env)).stdout);
  if (remotes.length === 0) throw new AgentError('no_remote', 'This repository has no remote to push to. The user can add one (for example by creating the repository on GitHub); do not add one yourself.');
  const configured = (await git(rootReal, ['config', `branch.${branch}.remote`], env)).stdout.trim();
  const remote = remotes.includes(configured) ? configured : remotes.includes('origin') ? 'origin' : remotes.length === 1 ? remotes[0] : null;
  if (!remote) throw new AgentError('which_remote', `This repository has several remotes (${remotes.join(', ')}) and the branch has no upstream. Ask the user which one to push to; they can set it with git push -u themselves.`);
  if (remote.startsWith('-')) throw new AgentError('bad_remote', 'That remote’s name isn’t one Quo will push to.');
  const merge = remote === configured ? (await git(rootReal, ['config', `branch.${branch}.merge`], env)).stdout.trim() : '';
  const remoteBranch = merge.startsWith('refs/heads/') ? merge.slice('refs/heads/'.length) : branch;
  const setUpstream = !merge;
  const url = (await git(rootReal, ['remote', 'get-url', '--push', remote], env)).stdout.trim();

  const defaultRef = (await git(rootReal, ['symbolic-ref', '--quiet', '--short', `refs/remotes/${remote}/HEAD`], env)).stdout.trim();
  const defaultBranch = defaultRef.startsWith(`${remote}/`) ? defaultRef.slice(remote.length + 1) : null;
  const tracking = `refs/remotes/${remote}/${remoteBranch}`;
  const known = (await git(rootReal, ['rev-parse', '--verify', '--quiet', tracking], env)).code === 0;
  // Compare with what the remote had at the last fetch: the branch itself, else (a new branch) the default branch.
  const base = known ? tracking : defaultBranch ? `refs/remotes/${remote}/${defaultBranch}` : null;
  if (known) {
    const behind = Number((await git(rootReal, ['rev-list', '--count', `HEAD..${tracking}`], env)).stdout.trim()) || 0;
    if (behind > 0) throw new AgentError('behind', `${remote}/${remoteBranch} has ${behind} commit${behind === 1 ? '' : 's'} this branch doesn’t, so a push would be rejected. Tell the user; they may want to pull first. Never force-push.`);
  }
  const range = base ? `${base}..HEAD` : 'HEAD';
  const count = Number((await git(rootReal, ['rev-list', '--count', range], env)).stdout.trim()) || 0;
  if (count === 0) throw new AgentError('nothing_to_push', `There are no new commits to push to ${remote}/${remoteBranch}. Commit first with git_commit.`);
  const commits = lines((await git(rootReal, ['log', `--max-count=${MAX_LISTED}`, '--format=%h %s', range], env)).stdout).map(line => redactSecrets(line).slice(0, 200));

  const status = await git(rootReal, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], env);
  await checkHooks(rootReal, env, parseStatus(status.stdout), 'push');

  const repo = githubRepo(url);
  const prePush = await hasHook(rootReal, env, 'pre-push');
  return {
    prePush,
    remote, url: displayUrl(url), branch, remoteBranch, setUpstream, count, commits, credit,
    defaultBranch, toDefault: Boolean(defaultBranch) && remoteBranch === defaultBranch,
    pullRequest: repo && defaultBranch && remoteBranch !== defaultBranch ? pullRequestUrl(repo, defaultBranch, remoteBranch, credit) : null,
  };
}

/** Why a push failed, in words the model can act on. */
function explain(output, plan) {
  const remoteSaidNo = /\[rejected\]|\[remote rejected\]|non-fast-forward|fetch first|permission denied|authentication failed|could not read|unable to access/i.test(output);
  if ((plan.prePush && !remoteSaidNo) || /pre-push hook/i.test(output)) return ['hook_failed', `A git hook stopped the push, so nothing was pushed. Fix what it reports, commit with git_commit, then push again (never bypass hooks):\n${output}`];
  if (/non-fast-forward|fetch first|\[rejected\]/i.test(output)) return ['behind', `${plan.remote}/${plan.remoteBranch} has commits this branch doesn’t, so the push was rejected. Tell the user; they may want to pull first. Never force-push.`];
  if (/permission denied|authentication failed|could not read (username|password)|terminal prompts disabled|access denied|403|publickey/i.test(output)) return ['auth', `Git couldn’t sign in to ${plan.url}. The user needs git sign-in set up for this remote (an SSH key in their agent, or a credential helper such as \`gh auth setup-git\`); do not try to work around it.`];
  if (/could not resolve host|unable to access|network|timed out/i.test(output)) return ['offline', `Git couldn’t reach ${plan.url}. Check the connection and try again later.`];
  return ['git_failed', `git push failed: ${output.slice(0, 600)}`];
}

/** Pushes exactly what was planned: HEAD to the planned branch of the planned remote, never forced. */
async function applyPush({ rootReal, env = process.env }, plan) {
  const args = ['push', '--no-force-with-lease', ...(plan.setUpstream ? ['--set-upstream'] : []), plan.remote, `HEAD:refs/heads/${plan.remoteBranch}`];
  const result = await git(rootReal, args, env, { timeoutMs: PUSH_TIMEOUT_MS });
  if (result.code !== 0) {
    const [code, message] = explain(redactSecrets(`${result.stderr}\n${result.stdout}`.trim()).slice(0, 1500), plan);
    throw new AgentError(code, message);
  }
}

module.exports = { planPush, applyPush, displayUrl, githubRepo, pullRequestUrl };
