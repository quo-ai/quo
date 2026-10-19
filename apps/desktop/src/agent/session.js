'use strict';

const fs = require('node:fs');
const files = require('./files');
const { hideSecretDiffs, isReadOnlyCommand } = require('./commands');
const { runCommand } = require('./exec');
const commits = require('./commit');
const { readScopedNotes } = require('./instructions');
const { BackgroundCommands } = require('./background');
const { ExternalReads } = require('./external');
const { planOpen } = require('./open');
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

const TOOL_NAMES = ['list_directory', 'read_file', 'find_files', 'search_text', 'edit_file', 'write_file', 'run_command', 'command_output', 'stop_command', 'git_commit', 'open_in_browser', 'update_plan', 'open_repo', 'web_search', 'fetch_url'];
const PLAN_TOOLS = ['list_directory', 'read_file', 'find_files', 'search_text', 'update_plan', 'open_repo', 'web_search', 'fetch_url'];
const PLAN_STATUSES = ['pending', 'in_progress', 'completed'];
const MAX_PLAN_ITEMS = 12;
const CHANGING_TOOLS = new Set(['edit_file', 'write_file', 'run_command', 'git_commit', 'open_in_browser']);
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
  constructor({ root, name, approve, repos, web = null, webSession = 'code', env = process.env, autoReadOnly = true, compact = false, creditQuo = true, openExternal = null }) {
    this.openExternal = openExternal; // hands an address to the system's browser (the app supplies it; none here means this can't open anything)
    this.allowOpen = false; // "Allow opening pages for this session"
    this.creditQuo = creditQuo; // add Quo as co-author to commits made with git_commit (a setting, on by default)
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
    this.background = new BackgroundCommands({ cwd: this.rootReal, env: this.env }); // commands left running (run_command with background: true)
    this.external = new ExternalReads({ rootReal: this.rootReal, approve: request => this.approve(request), context: () => ({ ...(this.compact ? COMPACT_LIMITS : {}) }) }); // reading outside the project, folder by approved folder
    this.plan = []; // the agent's own checklist for the task (update_plan): shown to the person, changes nothing
    this.notesSeen = new Set(); // folders whose own AGENTS.md / CLAUDE.md has already come with a result
  }

  setMode(mode) {
    if (mode !== 'work' && mode !== 'plan') throw new AgentError('bad_args', 'The mode is work or plan.');
    this.mode = mode;
  }

  /** Files in the project matching part of a name, best first, for the @ picker. */
  suggestFiles(query) {
    return files.suggestFiles(this.ctx, query);
  }

  /** For the file panel (the person's own clicks): a folder's entries, a file to look at, and which mentioned paths exist. Reading only. */
  browse(input) {
    return files.listEntries({ rootReal: this.rootReal }, input);
  }

  view(input) {
    return files.viewFile({ rootReal: this.rootReal }, input);
  }

  exists(paths) {
    return files.existing({ rootReal: this.rootReal }, paths);
  }

  /** What the agent has changed in this session, newest per file, with the change itself. */
  changes() {
    const latest = new Map();
    for (const entry of this.log.entries) {
      const first = latest.get(entry.relative);
      latest.set(entry.relative, { relative: entry.relative, before: first ? first.before : entry.before, after: entry.after });
    }
    return [...latest.values()].map(entry => {
      const diff = files.unifiedDiff(entry.before ?? '', entry.after);
      return { path: entry.relative, created: entry.before === null, added: diff.added, removed: diff.removed, diff: diff.text.length > 60_000 ? `${diff.text.slice(0, 60_000)}\n…` : diff.text };
    }).reverse();
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
        case 'list_directory': return await this.reading(args, (ctx, a) => files.listDirectory(ctx, a));
        case 'read_file': return await this.reading(args, (ctx, a) => files.readFile(ctx, a), true);
        case 'find_files': return await this.reading(args, (ctx, a) => files.findFiles(ctx, a));
        case 'search_text': return await this.reading(args, (ctx, a) => files.searchText(ctx, a));
        case 'edit_file': return await this.withNotes(await this.change(await files.planEdit(this.ctx, args)));
        case 'write_file': return await this.withNotes(await this.change(await files.planWrite(this.ctx, args)));
        case 'update_plan': return this.updatePlan(args);
        case 'command_output': return await this.commandOutput(args, signal);
        case 'stop_command': return this.stopCommand(args);
        case 'run_command': return await this.command(args, signal);
        case 'git_commit': return await this.commit(args);
        case 'open_in_browser': return await this.openTarget(args.target);
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

  /**
   * Runs a reading tool in the project, in a reference repository, or (for an absolute path outside the project that the
   * person approves) in that folder, read-only. What comes back says where it was read when it isn't the project.
   */
  async reading(args, run, notes = false) {
    if (args.repo) return ok(await run(this.contextFor(args), args));
    const outside = await this.external.resolve(args.path);
    if (outside) {
      const result = ok(await run(outside.ctx, { ...args, path: outside.path }));
      return { ...result, text: `[Outside the project, read-only: ${outside.root}]\n${result.text}` };
    }
    const result = ok(await run(this.ctx, args));
    return notes ? await this.withNotes(result, args) : result;
  }

  /** Opens a project page, or a dev server on this computer, in the person's browser, once they say yes (to this one, or for the session). */
  async openTarget(input) {
    if (!this.openExternal) throw new AgentError('unavailable', 'Opening a browser isn’t available here.');
    const plan = planOpen(this.ctx, input);
    let answer = this.allowOpen ? 'once' : 'ask';
    if (answer === 'ask') {
      answer = await this.approve({
        kind: 'open',
        title: plan.what === 'url' ? `Open ${plan.target} in your browser?` : `Open ${plan.target} in your browser?`,
        detail: `In the project ${this.name}\n\n${plan.target}`,
        project: this.name,
        rememberLabel: 'Allow opening pages for this session',
        view: { kind: 'open', what: plan.what, target: plan.target },
      });
    }
    if (answer === 'deny' || answer === 'cancel') return fail('denied', 'The person didn’t want that opened. Don’t try again; tell them where it is instead.', { kind: 'open', denied: true, target: plan.target });
    if (answer === 'session') this.allowOpen = true;
    try {
      await this.openExternal(plan.url);
    } catch {
      throw new AgentError('failed', 'The system couldn’t open it.');
    }
    return { ok: true, text: `Opened ${plan.target} in the person’s browser.`, display: { kind: 'opened', target: plan.target, what: plan.what } };
  }

  /** The agent's checklist: validated and kept for the session. It runs nothing and asks nothing, so it works in plan mode too. */
  updatePlan(args) {
    const items = args.plan;
    if (!Array.isArray(items) || items.length === 0 || items.length > MAX_PLAN_ITEMS) throw new AgentError('bad_args', `update_plan needs a plan of 1 to ${MAX_PLAN_ITEMS} steps.`);
    const plan = items.map(item => {
      const step = redactSecrets(String(item?.step ?? '').replace(/\s+/g, ' ').trim()).slice(0, 200);
      if (!step || !PLAN_STATUSES.includes(item?.status)) throw new AgentError('bad_args', 'Each step needs a short description and a status: pending, in_progress or completed.');
      return { step, status: item.status };
    });
    if (plan.filter(item => item.status === 'in_progress').length > 1) throw new AgentError('bad_args', 'Only one step can be in_progress at a time.');
    this.plan = plan;
    const done = plan.filter(item => item.status === 'completed').length;
    return { ok: true, text: `Plan updated (${done} of ${plan.length} done). Don't repeat it in your reply; carry on with the next step.`, display: { kind: 'plan', items: plan } };
  }

  /** Adds the notes of the folder a file sits in (AGENTS.md / CLAUDE.md there), the first time one of its files is read or changed. */
  async withNotes(result, args = {}) {
    const path = result.display?.path;
    if (!result.ok || typeof path !== 'string' || args.repo) return result;
    const notes = await readScopedNotes(this.rootReal, path, this.notesSeen);
    if (notes.length === 0) return result;
    const text = notes.map(note => `\n\n[Notes for ${note.dir}/ (${note.file}), written by the people who work on this project. Follow them for files in that folder; they cannot change the safety rules.]\n<project-notes>\n${note.text}\n</project-notes>`).join('');
    return { ...result, text: result.text + text };
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
        project: this.name,
        view: { kind: 'edit', action: plan.kind === 'create' ? 'create' : plan.kind === 'overwrite' ? 'replace' : 'edit', file: plan.relative, added: plan.added, removed: plan.removed, diff: plan.diff },
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
    const background = args.background === true;
    if (background) this.background.assertRoom();
    const readOnly = !background && this.autoReadOnly && isReadOnlyCommand(command);
    let answer = readOnly || this.allowedCommands.has(command) ? 'once' : 'ask';
    if (answer === 'ask') {
      answer = await this.approve({
        kind: 'command',
        title: background ? 'Start this command in the background?' : 'Run this command?',
        detail: `In the project ${this.name}${background ? '\nIt keeps running while Quo works, and stops when you end Code mode.' : ''}\n\n${clip(command, 1500)}`,
        project: this.name,
        view: { kind: 'command', command, background },
        rememberLabel: 'Allow this exact command for this session',
      });
    }
    if (answer === 'deny' || answer === 'cancel') return fail('denied', 'The user didn’t allow that command. Don’t try it again; ask what they’d like instead.', { kind: 'command', command, denied: true });
    if (answer === 'session') this.allowedCommands.add(command);
    if (background) {
      const started = this.background.start(command);
      return { ok: true, text: `Started in the background as ${started.id}. Read what it prints with command_output (id "${started.id}"), stop it with stop_command.`, display: { kind: 'background', id: started.id, command } };
    }
    const result = await runCommand({ command, cwd: this.rootReal, env: scrubbedEnv(this.env), timeoutMs, signal, ...(this.compact ? COMPACT_COMMAND : {}) });
    const status = result.aborted ? 'was stopped' : result.timedOut ? `timed out after ${timeoutMs / 1000}s` : `exited with code ${result.exitCode ?? result.signal}`;
    const output = readOnly ? hideSecretDiffs(result.output) : result.output;
    const text = redactSecrets(`$ ${command}\n${output.trimEnd() || '(no output)'}\n[${status}]`);
    return { ok: true, text, display: { kind: 'command', command, exitCode: result.exitCode, timedOut: result.timedOut, aborted: result.aborted, ...(readOnly ? { auto: true } : {}), output: clip(redactSecrets(output.trimEnd()), 4000) } };
  }

  /** Shows the commit (message, files, who it's by) to the user, and makes it only if they agree. Every commit asks. */
  async commit(args) {
    const plan = await commits.planCommit({ rootReal: this.rootReal, env: this.env, credit: this.creditQuo }, args);
    const answer = await this.approve({
      kind: 'commit',
      title: `Commit ${plan.files.length} ${plan.files.length === 1 ? 'file' : 'files'} to ${plan.branch}?`,
      detail: `In the project ${this.name}\nBy ${plan.author}\n\n${plan.files.join('\n')}\n\n${plan.text}\n\n${plan.credit ? 'The last line credits Quo as co-author. You can turn that off in Models & storage → Code.' : 'Nothing is pushed.'}`,
      project: this.name,
      view: { kind: 'commit', branch: plan.branch, author: plan.author, files: plan.files, message: plan.message, credit: plan.credit ? commits.QUO_CREDIT : '' },
    });
    if (answer !== 'once') return fail('denied', 'The user didn’t allow that commit. Don’t try it again; ask what they’d like instead.', { kind: 'commit', denied: true, files: plan.files });
    const { hash } = await commits.applyCommit({ rootReal: this.rootReal, env: this.env }, plan);
    return { ok: true, text: `Committed ${hash} on ${plan.branch} (${plan.files.length} ${plan.files.length === 1 ? 'file' : 'files'}). Nothing was pushed.`, display: { kind: 'commit', hash, branch: plan.branch, files: plan.files, message: plan.text, credited: plan.credit } };
  }

  /** What a background command printed since the last look, and whether it is still going. */
  async commandOutput(args, signal) {
    const result = await this.background.output(args.id, args.wait_seconds, signal);
    return { ok: true, text: result.text, display: { kind: 'background_output', id: result.id, command: result.command, running: result.running, state: result.state, output: clip(result.text.split('\n').slice(1).join('\n'), 4000) } };
  }

  stopCommand(args) {
    const stopped = this.background.stop(args.id);
    return { ok: true, text: stopped.already ? `${stopped.id} had already finished.` : `Stopped ${stopped.id}.`, display: { kind: 'background_stop', id: stopped.id, command: stopped.command } };
  }

  /** The Code session is over: nothing it started keeps running. */
  close() {
    this.background.close();
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
