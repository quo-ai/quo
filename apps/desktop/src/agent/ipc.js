'use strict';

const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { trusted } = require('../trust');
const { AgentError, checkProjectRoot } = require('./safety');
const { RepoCache } = require('./repos');
const { readInstructions } = require('./instructions');
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

/** What the page may know about a project: an id and a name, never the path. */
const publicProject = project => ({ id: project.id, name: project.name });

function setupAgent() {
  const userData = app.getPath('userData');
  const projects = new Projects(path.join(userData, 'code-projects.json'));
  const repos = new RepoCache({ directory: path.join(userData, 'code-repos') });
  const sessions = new Map();

  /** Asks the person, in a window the page can't draw or click, whether to allow something. */
  async function ask(window, request) {
    const buttons = request.kind === 'command' ? ['Run it', request.rememberLabel, 'Don’t run it'] : ['Allow', request.rememberLabel, 'Don’t allow'];
    try {
      const result = await dialog.showMessageBox(window ?? undefined, {
        type: 'question',
        title: 'Quo Code',
        message: request.title,
        detail: request.detail.length > DIALOG_DETAIL_CHARS ? `${request.detail.slice(0, DIALOG_DETAIL_CHARS)}…` : request.detail,
        buttons,
        defaultId: 2, // Enter means no.
        cancelId: 2,
        noLink: true,
      });
      return ['once', 'session', 'deny'][result.response] ?? 'deny';
    } catch {
      return 'deny';
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
    const real = await fsp.realpath(result.filePaths[0]);
    checkProjectRoot(real);
    return publicProject(await projects.add(real));
  });

  handle('agent:forget', ({ id }) => projects.remove(String(id)));

  handle('agent:start', async ({ projectId, autoReadOnly }, event) => {
    const project = (await projects.list()).find(entry => entry.id === String(projectId));
    if (!project) throw new AgentError('no_project', 'That project isn’t in the list any more. Choose the folder again.');
    const real = await fsp.realpath(project.path).catch(() => null);
    if (!real) throw new AgentError('no_project', 'That folder can’t be found any more.');
    checkProjectRoot(real);
    for (const [id, entry] of sessions) if (entry.owner === event.sender.id && entry.project === project.id) endSession(id);
    if (sessions.size >= MAX_SESSIONS) throw new AgentError('busy', 'Too many Code sessions are open. Close one first.');
    const id = crypto.randomBytes(8).toString('hex');
    const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const session = new AgentSession({ root: real, name: project.name, repos, autoReadOnly: autoReadOnly !== false, approve: request => ask(window, request) });
    sessions.set(id, { session, owner: event.sender.id, project: project.id, controller: null });
    event.sender.once('destroyed', () => endSession(id));
    return { sessionId: id, name: project.name, platform: process.platform, tools: TOOL_NAMES, planTools: PLAN_TOOLS, instructions: await readInstructions(real) };
  });

  handle('agent:mode', ({ sessionId, mode }, event) => owned(sessionId, event).session.setMode(mode));

  handle('agent:undo', async ({ sessionId, count }, event) => owned(sessionId, event).session.undo(count));

  handle('agent:tool', async ({ sessionId, name, args }, event) => {
    const entry = owned(sessionId, event);
    entry.controller?.abort();
    entry.controller = new AbortController();
    try {
      return await entry.session.callTool(String(name), args, { signal: entry.controller.signal });
    } finally {
      entry.controller = null;
    }
  });

  handle('agent:abort', ({ sessionId }, event) => {
    owned(sessionId, event).controller?.abort();
  });

  handle('agent:end', ({ sessionId }, event) => {
    owned(sessionId, event);
    endSession(String(sessionId));
  });

  handle('agent:clear-repos', () => repos.clear());

  function endSession(id) {
    const entry = sessions.get(id);
    entry?.controller?.abort();
    sessions.delete(id);
  }

  app.on('will-quit', () => {
    for (const entry of sessions.values()) entry.controller?.abort();
  });
  return { sessions };
}

module.exports = { setupAgent };
