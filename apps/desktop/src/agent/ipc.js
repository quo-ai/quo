'use strict';

const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { trusted } = require('../trust');
const { AgentError, checkProjectRoot } = require('./safety');
const { RepoCache } = require('./repos');
const { askInApp } = require('../approval/window');
const { findRepoRoot, gitInfo } = require('./git');
const { whereIs } = require('./location');
const { readInstructions } = require('./instructions');
const { createWorkspace } = require('./workspace');
const { AgentSession, PLAN_TOOLS, TOOL_NAMES } = require('./session');

/**
 * Connects the web app's Code mode to the agent. Everything is reachable only from
 * the app's own pages (app://quo), and the page never gets to say where files are:
 *
 *  - The project folder comes from a native folder dialog, and the page only ever
 *    holds an id for it, so it can't point a session at any other folder.
 *  - Edits and commands are approved in native dialogs raised from here, not by the
 *    page, so a page that has been tricked can't approve its own requests.
 *  - A session belongs to the window that started it.
 */

const MAX_SESSIONS = 4;
const MAX_PROJECTS = 20;
const DIALOG_DETAIL_CHARS = 3000;

class Projects {
  constructor(file) {
    this.file = file;
  }

  async list() {
    try {
      const data = JSON.parse(await fsp.readFile(this.file, 'utf8'));
      return Array.isArray(data.projects) ? data.projects.filter(p => p && typeof p.id === 'string' && typeof p.path === 'string') : [];
    } catch {
      return [];
    }
  }

  async save(projects) {
    await fsp.writeFile(this.file, JSON.stringify({ projects: projects.slice(0, MAX_PROJECTS) }));
  }

  async add(rootReal) {
    const projects = await this.list();
    const existing = projects.find(project => project.path === rootReal);
    const entry = existing ?? { id: crypto.randomBytes(6).toString('hex'), path: rootReal, name: path.basename(rootReal) || rootReal };
    await this.save([{ ...entry, at: Date.now() }, ...projects.filter(project => project.id !== entry.id)]);
    return entry;
  }

  async remove(id) {
    await this.save((await this.list()).filter(project => project.id !== id));
  }
}

/** What the page may know about a project: an id, a name and roughly where it is, never the path itself. */
const publicProject = project => ({ id: project.id, name: project.name, hint: whereIs(project.path) });

function setupAgent({ web = null } = {}) {
  const userData = app.getPath('userData');
  const projects = new Projects(path.join(userData, 'code-projects.json'));
  const repos = new RepoCache({ directory: path.join(userData, 'code-repos') });
  const sessions = new Map();

  /** Asks the person, in a window the page can't draw or click, whether to allow something. */
  async function askNative(window, request) {
    // A commit is always asked about, with no "for this session" choice.
    const single = request.kind === 'commit';
    const buttons = single ? ['Commit', 'Don’t commit'] : request.kind === 'command' ? ['Run it', request.rememberLabel, 'Don’t run it'] : ['Allow', request.rememberLabel, 'Don’t allow'];
    try {
      const result = await dialog.showMessageBox(window ?? undefined, {
        type: 'question',
        title: 'Quo Code',
        message: request.title,
        detail: request.detail.length > DIALOG_DETAIL_CHARS ? `${request.detail.slice(0, DIALOG_DETAIL_CHARS)}…` : request.detail,
        buttons,
        defaultId: buttons.length - 1, // Enter means no.
        cancelId: buttons.length - 1,
        noLink: true,
      });
      return (single ? ['once', 'deny'] : ['once', 'session', 'deny'])[result.response] ?? 'deny';
    } catch {
      return 'deny';
    }
  }

  /**
   * Asks the person, in a window the page can't draw or click, whether to allow something: Quo's own styled window
   * (approval/window.js) when it can show the request, the plain system dialog otherwise.
   */
  async function ask(window, request) {
    try {
      return await askInApp(window, request);
    } catch {
      return askNative(window, request);
    }
  }

  const handle = (channel, task) =>
    ipcMain.handle(channel, async (event, payload) => {
      if (!trusted(event)) return { error: { code: 'untrusted', message: 'Not allowed.' } };
      try {
        return { ok: await task(payload ?? {}, event) };
      } catch (error) {
        if (error instanceof AgentError) return { error: { code: error.code, message: error.message } };
        console.warn(`[${channel}]`, error);
        return { error: { code: 'failed', message: 'Something went wrong.' } };
      }
    });

  const abortAll = entry => {
    for (const controller of entry.controllers) controller.abort();
  };

  const owned = (id, event) => {
    const entry = sessions.get(String(id));
    if (!entry || entry.owner !== event.sender.id) throw new AgentError('no_session', 'That Code session has ended.');
    return entry;
  };

  handle('agent:projects', async () => {
    const present = [];
    for (const project of await projects.list()) {
      if (await fsp.stat(project.path).then(stat => stat.isDirectory(), () => false)) present.push(publicProject(project));
    }
    return present;
  });

  handle('agent:pick', async (_payload, event) => {
    const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const result = await dialog.showOpenDialog(window, {
      title: 'Choose the project folder for Code mode',
      message: 'Quo can read the files in this folder, and change them or run commands only when you say yes each time.',
      buttonLabel: 'Use this folder',
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    let real = await fsp.realpath(result.filePaths[0]);
    checkProjectRoot(real);
    // A folder inside a git repository: offer the whole repository (its notes, branch and sibling folders), as opencode
    // does by default. Choosing narrower is the default button: Enter keeps the person's own pick.
    const repo = findRepoRoot(real, { isOk: dir => { try { checkProjectRoot(dir); return true; } catch { return false; } } });
    if (repo) {
      const choice = await dialog.showMessageBox(window, {
        type: 'question',
        title: 'Quo Code',
        message: `Work in the whole ${path.basename(repo)} repository?`,
        detail: `${path.basename(real)} is a folder inside the git repository ${path.basename(repo)} (${whereIs(repo)}).\n\nQuo can work in just this folder, or in the whole repository, which gives it the project's notes and everything the folder depends on. It still asks before changing anything.`,
        buttons: ['Whole repository', 'Only this folder'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      });
      if (choice.response === 0) real = await fsp.realpath(repo);
    }
    return publicProject(await projects.add(real));
  });

  // A new, empty folder under Documents/Quo Projects for something the person asked Quo to build. The page supplies only
  // words to name it with; the place and the allowed characters are decided in workspace.js.
  handle('agent:workspace', async ({ name }) => {
    const real = await createWorkspace(path.join(app.getPath('documents'), 'Quo Projects'), typeof name === 'string' ? name.slice(0, 200) : '');
    checkProjectRoot(real);
    return publicProject(await projects.add(real));
  });

  handle('agent:forget', ({ id }) => projects.remove(String(id)));

  handle('agent:start', async ({ projectId, autoReadOnly, compact, creditQuo }, event) => {
    const project = (await projects.list()).find(entry => entry.id === String(projectId));
    if (!project) throw new AgentError('no_project', 'That project isn’t in the list any more. Choose the folder again.');
    const real = await fsp.realpath(project.path).catch(() => null);
    if (!real) throw new AgentError('no_project', 'That folder can’t be found any more.');
    checkProjectRoot(real);
    for (const [id, entry] of sessions) if (entry.owner === event.sender.id && entry.project === project.id) endSession(id);
    if (sessions.size >= MAX_SESSIONS) throw new AgentError('busy', 'Too many Code sessions are open. Close one first.');
    const id = crypto.randomBytes(8).toString('hex');
    const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const session = new AgentSession({ root: real, name: project.name, repos, web, webSession: id, autoReadOnly: autoReadOnly !== false, compact: compact === true, creditQuo: creditQuo !== false, openExternal: url => shell.openExternal(url), approve: request => ask(window, request) });
    sessions.set(id, { session, owner: event.sender.id, project: project.id, controllers: new Set() });
    event.sender.once('destroyed', () => endSession(id));
    return { sessionId: id, name: project.name, platform: process.platform, tools: compact === true ? TOOL_NAMES.filter(name => name !== 'update_plan') : TOOL_NAMES, planTools: compact === true ? PLAN_TOOLS.filter(name => name !== 'update_plan') : PLAN_TOOLS, instructions: await readInstructions(real), hint: whereIs(real), git: await gitInfo(real) };
  });

  handle('agent:files', ({ sessionId, query }, event) => owned(sessionId, event).session.suggestFiles(query));

  handle('agent:mode', ({ sessionId, mode }, event) => owned(sessionId, event).session.setMode(mode));

  handle('agent:undo', async ({ sessionId, count }, event) => owned(sessionId, event).session.undo(count));

  handle('agent:tool', async ({ sessionId, name, args }, event) => {
    // Several reading tools may be in flight at once (the page sends a reply's independent reads together), so each
    // call has its own controller; "stop" aborts all of them.
    const entry = owned(sessionId, event);
    const controller = new AbortController();
    entry.controllers.add(controller);
    try {
      return await entry.session.callTool(String(name), args, { signal: controller.signal });
    } finally {
      entry.controllers.delete(controller);
    }
  });

  handle('agent:abort', ({ sessionId }, event) => {
    abortAll(owned(sessionId, event));
  });

  handle('agent:end', ({ sessionId }, event) => {
    owned(sessionId, event);
    endSession(String(sessionId));
  });

  handle('agent:clear-repos', () => repos.clear());

  function endSession(id) {
    const entry = sessions.get(id);
    if (entry) {
      abortAll(entry);
      entry.session.close();
    }
    sessions.delete(id);
  }

  app.on('will-quit', () => {
    for (const entry of sessions.values()) {
      abortAll(entry);
      entry.session.close();
    }
  });
  return { sessions };
}

module.exports = { setupAgent };
