'use strict';

const fs = require('node:fs');
const files = require('./files');
const { hideSecretDiffs, isReadOnlyCommand } = require('./commands');
const { runCommand } = require('./exec');
const { ChangeLog } = require('./history');
const { AgentError, redactSecrets, scrubbedEnv } = require('./safety');

/**
 * One Code-mode session: a project folder (chosen by the user in a native dialog),
 * the reference repositories opened so far, and what the user has allowed.
 *
 * `callTool` is the only way in. Reading tools run freely inside the project (or an
 * opened reference repository). Anything that changes things (edit_file, write_file,
 * run_command) first asks `approve`, which the main process implements with a native
 * dialog, so nothing in the page can answer it. The exception is a short list of
 * read-only commands (`git status`, `node --version`), which just run. In plan mode
 * nothing can change at all. Results are plain text for the model plus a small
 * `display` for the chat view; errors come back as results, not throws, so the model
 * can adjust.
 */

const TOOL_NAMES = ['list_directory', 'read_file', 'find_files', 'search_text', 'edit_file', 'write_file', 'run_command', 'open_repo', 'web_search', 'fetch_url'];
const PLAN_TOOLS = ['list_directory', 'read_file', 'find_files', 'search_text', 'open_repo', 'web_search', 'fetch_url'];
const CHANGING_TOOLS = new Set(['edit_file', 'write_file', 'run_command']);
const MAX_CALLS = 500;
const COMMAND_CHARS = 4000;
// What a small context window can afford for one tool result (about 4,000 tokens at most).
const COMPACT_LIMITS = { readLines: 150, outputChars: 10_000, listEntries: 120, findResults: 80, searchResults: 40 };
const COMPACT_COMMAND = { headChars: 2500, tailChars: 5000 };
const PREVIEW_LINES = 30;

const clip = (text, max) => (text.length > max ? `${text.slice(0, max)}…` : text);
const preview = diff => {
  const lines = diff.split('\n');
  return lines.length > PREVIEW_LINES ? `${lines.slice(0, PREVIEW_LINES).join('\n')}\n… (${lines.length - PREVIEW_LINES} more lines)` : diff;
};

class AgentSession {
  constructor({ root, name, approve, repos, web = null, webSession = 'code', env = process.env, autoReadOnly = true, compact = false }) {
    this.web = web; // search and page reading (web/service.js), or none
    this.webSession = webSession;
    this.rootReal = fs.realpathSync.native(root);
    this.name = name;
    this.approve = approve;
    this.repos = repos;
    this.env = env;
    this.compact = compact; // a small context window (an offline model): shorter file pages and command output
    this.autoReadOnly = autoReadOnly; // run read-only commands without asking (a setting; off means every command asks)
    this.reads = new Map();
    this.opened = new Map(); // `owner/name` -> { rootReal, reads }
    this.allowEdits = false;
    this.allowedCommands = new Set();
    this.calls = 0;
    this.mode = 'work'; // or 'plan': read-only
    this.log = new ChangeLog();
  }

  setMode(mode) {
    if (mode !== 'work' && mode !== 'plan') throw new AgentError('bad_args', 'The mode is work or plan.');
    this.mode = mode;
  }

  /** Takes back the last `count` changes the agent made, where the files are still as it left them. */
  undo(count) {
    return this.log.undo(this.ctx, count);
  }

  get ctx() {
    return { rootReal: this.rootReal, reads: this.reads, ...(this.compact ? COMPACT_LIMITS : {}) };
  }

  /** The folder a read-only tool works in: the project, or a reference repository opened earlier. */
  contextFor(args) {
    if (args.repo === undefined || args.repo === null || args.repo === '') return this.ctx;
    const key = String(args.repo).replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').toLowerCase();
    const opened = [...this.opened.entries()].find(([name]) => name.toLowerCase() === key);
    if (!opened) throw new AgentError('repo_not_open', `Open ${args.repo} first with open_repo.`);
    return opened[1];
  }

  async callTool(name, args = {}, { signal } = {}) {
    if (++this.calls > MAX_CALLS) return fail('limit', 'This session has used its limit of tool calls. Start a new one.');
    if (typeof args !== 'object' || args === null || Array.isArray(args)) return fail('bad_args', 'The arguments must be an object.');
    try {
      if (!TOOL_NAMES.includes(name)) throw new AgentError('unknown_tool', `There’s no tool called ${name}.`);
      if (CHANGING_TOOLS.has(name) && this.mode === 'plan') throw new AgentError('plan_mode', 'Plan mode is on, so nothing can be changed or run. Describe the plan instead, and the user can switch it off to carry it out.');
      if (CHANGING_TOOLS.has(name) && args.repo) throw new AgentError('read_only', 'Reference repositories are read-only. Changes go in the project folder.');
      switch (name) {
        case 'list_directory': return ok(await files.listDirectory(this.contextFor(args), args));
        case 'read_file': return ok(await files.readFile(this.contextFor(args), args));
        case 'find_files': return ok(await files.findFiles(this.contextFor(args), args));
        case 'search_text': return ok(await files.searchText(this.contextFor(args), args));
        case 'edit_file': return await this.change(await files.planEdit(this.ctx, args));
        case 'write_file': return await this.change(await files.planWrite(this.ctx, args));
        case 'run_command': return await this.command(args, signal);
        case 'open_repo': return await this.openRepo(args);
        case 'web_search': return ok(await this.needWeb().search(this.webSession, args.query, { count: args.count, maxChars: this.webChars }));
        case 'fetch_url': return ok(await this.needWeb().read(this.webSession, args.url, { maxChars: this.webChars }));
      }
    } catch (error) {
      if (error instanceof AgentError) return fail(error.code, error.message);
      console.warn(`[agent] ${name}`, error);
      return fail('failed', 'That didn’t work.');
    }
    return fail('unknown_tool', `There’s no tool called ${name}.`);
  }

  /** Shows an edit or a new file to the user, and writes it only if they agree. */
  async change(plan) {
    let answer = this.allowEdits ? 'once' : 'ask';
    if (answer === 'ask') {
      const verb = plan.kind === 'create' ? 'Create' : plan.kind === 'overwrite' ? 'Replace' : 'Edit';
      answer = await this.approve({
        kind: 'edit',
        title: `${verb} ${plan.relative}?`,
        detail: `In the project ${this.name}\n+${plan.added} −${plan.removed} lines\n\n${preview(plan.diff)}`,
        rememberLabel: 'Allow edits to this project for this session',
      });
    }
    if (answer === 'deny' || answer === 'cancel') return fail('denied', 'The user didn’t allow that change. Don’t try it again; ask what they’d like instead.', { kind: 'edit', path: plan.relative, denied: true });
    if (answer === 'session') this.allowEdits = true;
    await files.applyPlan(this.ctx, plan);
    this.log.record(plan);
    const label = plan.kind === 'create' ? `Created ${plan.relative}` : `Edited ${plan.relative}`;
    return { ok: true, text: `${label} (+${plan.added} −${plan.removed}).`, display: { kind: plan.kind === 'create' ? 'create' : 'edit', path: plan.relative, added: plan.added, removed: plan.removed, diff: plan.diff } };
  }

  async command(args, signal) {
    const command = String(args.command ?? '').trim();
    if (!command) throw new AgentError('bad_args', 'run_command needs a command.');
    if (command.length > COMMAND_CHARS) throw new AgentError('bad_args', 'That command is too long.');
    const timeoutMs = Math.min(600, Math.max(1, Number(args.timeout_seconds) || 120)) * 1000;
    const readOnly = this.autoReadOnly && isReadOnlyCommand(command);
    let answer = readOnly || this.allowedCommands.has(command) ? 'once' : 'ask';
    if (answer === 'ask') {
      answer = await this.approve({
        kind: 'command',
        title: 'Run this command?',
        detail: `In the project ${this.name}\n\n${clip(command, 1500)}`,
        rememberLabel: 'Allow this exact command for this session',
      });
    }
    if (answer === 'deny' || answer === 'cancel') return fail('denied', 'The user didn’t allow that command. Don’t try it again; ask what they’d like instead.', { kind: 'command', command, denied: true });
    if (answer === 'session') this.allowedCommands.add(command);
    const result = await runCommand({ command, cwd: this.rootReal, env: scrubbedEnv(this.env), timeoutMs, signal, ...(this.compact ? COMPACT_COMMAND : {}) });
    const status = result.aborted ? 'was stopped' : result.timedOut ? `timed out after ${timeoutMs / 1000}s` : `exited with code ${result.exitCode ?? result.signal}`;
    const output = readOnly ? hideSecretDiffs(result.output) : result.output;
    const text = redactSecrets(`$ ${command}\n${output.trimEnd() || '(no output)'}\n[${status}]`);
    return { ok: true, text, display: { kind: 'command', command, exitCode: result.exitCode, timedOut: result.timedOut, aborted: result.aborted, ...(readOnly ? { auto: true } : {}), output: clip(redactSecrets(output.trimEnd()), 4000) } };
  }

  needWeb() {
    if (!this.web) throw new AgentError('unavailable', 'Web access isn’t available here.');
    return this.web;
  }

  get webChars() {
    return this.compact ? 5000 : 14_000;
  }

  async openRepo(args) {
    if (!this.repos) throw new AgentError('unavailable', 'Reference repositories aren’t available.');
    const repo = await this.repos.open(args.repo, args.ref);
    this.opened.set(repo.name, { rootReal: fs.realpathSync.native(repo.root), reads: new Map() });
    const text = [
      `Opened ${repo.name} (${repo.ref === 'HEAD' ? 'default branch' : repo.ref}). Use the repo argument "${repo.name}" with list_directory, read_file, find_files and search_text. It is read-only.`,
      `Top level: ${repo.top.join(', ')}`,
      repo.excerpt ? `\nREADME:\n${repo.excerpt}` : '',
    ].join('\n');
    return { ok: true, text: redactSecrets(text), display: { kind: 'repo', repo: repo.name, ref: repo.ref } };
  }
}

const ok = result => ({ ok: true, text: result.text, display: result.display });
const fail = (code, message, display) => ({ ok: false, text: message, display: display ?? { kind: 'error', code } });

module.exports = { AgentSession, TOOL_NAMES, PLAN_TOOLS };
