'use strict';

const { AgentError } = require('./safety');

/**
 * Git commands the model writes for run_command, read before the approval window opens.
 *
 *  - Committing and pushing have their own tools (git_commit, git_push): those show the person what goes in or up, refuse
 *    secrets files, never force, and add the co-author line. A `git commit` or `git push` command is sent back to the
 *    model to use them instead.
 *  - Force pushes, deleting remote branches and skipping hooks (--no-verify) are refused outright.
 *  - Commands that can throw away work (reset --hard, clean -f, checkout --, branch -D…) still go to the person, with a
 *    warning line in the approval window.
 *
 * This guides the model; it is not the security boundary (every command still needs the person's OK, and a command can
 * always be written so that this doesn't recognise it). It splits a command into its parts the way a shell would at
 * ; & | and new lines, skips VAR=value prefixes and git's own options, and looks at the subcommand.
 */

// git's options that come before the subcommand and take a value as the next word.
const VALUE_OPTIONS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env']);
const FORCE = /^(--force|--force-with-lease(=.*)?|--force-if-includes|-f|--mirror|--delete|-d|--prune)$/;

/** Each git invocation in a command line: its subcommand and the words after it. */
function gitCalls(command) {
  const calls = [];
  for (const part of String(command ?? '').split(/&&|\|\||[;&|\n]/)) {
    const words = part.trim().replace(/^[({\s]+/, '').split(/\s+/).filter(Boolean);
    while (words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) words.shift(); // VAR=value git …
    if (words[0] === 'sudo' || words[0] === 'command' || words[0] === 'exec') words.shift();
    if (!words.length || !/^(.*[\\/])?git(\.exe)?$/i.test(words[0].replace(/^["']|["']$/g, ''))) continue;
    let i = 1;
    while (i < words.length && words[i].startsWith('-')) i += VALUE_OPTIONS.has(words[i]) ? 2 : 1;
    if (i < words.length) calls.push({ sub: words[i].toLowerCase(), args: words.slice(i + 1) });
  }
  return calls;
}

/** Throws when a command must not run as written; returns a warning for the approval window, or ''. */
function checkGitCommand(command, { allowPush = true } = {}) {
  const warnings = [];
  for (const { sub, args } of gitCalls(command)) {
    if (args.includes('--no-verify') || (sub === 'commit' && args.includes('-n'))) throw new AgentError('no_verify', 'Skipping git hooks (--no-verify) isn’t allowed. If a hook fails, fix what it reports instead.');
    if (sub === 'commit') {
      if (args.some(arg => arg === '--amend')) throw new AgentError('use_tool', 'Quo doesn’t amend commits: make a new commit with git_commit instead. If the user wants an amend, they can run it themselves.');
      throw new AgentError('use_tool', 'Commit with the git_commit tool, not a command: it shows the user the files and message, keeps secrets files out and adds the co-author line.');
    }
    if (sub === 'push') {
      if (args.some(arg => FORCE.test(arg) || /^\+/.test(arg) || /^:/.test(arg))) throw new AgentError('force_push', 'Force-pushing and deleting remote branches aren’t allowed: never rewrite or remove what is on the remote. Tell the user what you wanted to do.');
      throw new AgentError(allowPush ? 'use_tool' : 'push_off', allowPush
        ? 'Push with the git_push tool, not a command: it shows the user the commits going up and never forces.'
        : 'Pushing is turned off in the user’s settings (Models & storage → Code). The commits are ready; tell the user so they can push them.');
    }
    if (sub === 'reset' && args.includes('--hard')) warnings.push('Throws away uncommitted changes (reset --hard).');
    else if (sub === 'clean' && args.some(arg => /^-[a-z]*f/i.test(arg) || arg === '--force')) warnings.push('Deletes untracked files for good (clean -f).');
    else if ((sub === 'checkout' || sub === 'restore') && (args.includes('--') || args.includes('.'))) warnings.push('Throws away uncommitted changes to these files.');
    else if (sub === 'branch' && args.some(arg => arg === '-D' || (arg === '-d' && args.includes('--force')))) warnings.push('Deletes a branch, even if it isn’t merged (branch -D).');
    else if (sub === 'stash' && (args[0] === 'drop' || args[0] === 'clear')) warnings.push('Deletes stashed changes for good.');
    else if (sub === 'rebase' || (sub === 'filter-branch') || (sub === 'filter-repo')) warnings.push('Rewrites history: commits change their ids.');
  }
  return warnings.join(' ');
}

module.exports = { checkGitCommand, gitCalls };
