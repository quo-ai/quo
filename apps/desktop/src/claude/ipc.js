'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, ipcMain } = require('electron');
const { trusted } = require('../trust');
const { findClaude } = require('./locate');
const { loadSdk } = require('./sdk');
const { baseOptions, childEnv } = require('./options');
const { ModelCatalog } = require('./catalog');
const { ClaudeSessions } = require('./sessions');
const { checkClaude } = require('./status');
const { ClaudeError } = require('./turn');
const { checkRequest } = require('./validate');

/**
 * Claude Agent: Claude models through the person's own Claude Code login (apps/desktop/README.md → Claude Agent).
 * Reachable only from the app's own pages. The page can ask whether Claude Code is ready, send a conversation and
 * stop a reply. It can't choose the program, its settings or its environment, and it never sees the login: Claude
 * Code signs in through Anthropic's own flow and keeps its credentials to itself.
 */

function setupClaude() {
  // Claude Code's working folder: an empty one of Quo's own. It has no tools, so it reads nothing there.
  const cwd = path.join(app.getPath('userData'), 'claude-agent');
  const base = () => {
    const executable = findClaude();
    if (!executable) throw new ClaudeError('claude_missing', 'Claude Code isn’t installed. Install it, run `claude auth login` in a terminal, then try again.');
    fs.mkdirSync(cwd, { recursive: true });
    return baseOptions({ executable, env: childEnv(process.env, app.getVersion()), cwd });
  };
  // Conversation transcripts live in Claude Code's folder for `cwd` while Quo uses them, and are deleted after.
  const forget = sessionId => loadSdk().then(({ deleteSession }) => deleteSession(sessionId, { dir: cwd }));
  const sweep = async () => {
    const { listSessions, deleteSession } = await loadSdk();
    for (const left of await listSessions({ dir: cwd, includeWorktrees: false })) await deleteSession(left.sessionId, { dir: cwd }).catch(() => {});
  };
  const sessions = new ClaudeSessions({ base, forget, sweep });
  const catalog = new ModelCatalog();
  const owners = new Map(); // request id -> the window that sent it

  const handle = (channel, task) =>
    ipcMain.handle(channel, async (event, payload) => {
      if (!trusted(event)) return { error: { code: 'untrusted', message: 'Not allowed.' } };
      try {
        return { ok: await task(payload ?? {}, event) };
      } catch (error) {
        if (error instanceof ClaudeError) return { error: { code: error.code, message: error.message } };
        console.warn(`[${channel}]`, error.message);
        return { error: { code: 'failed', message: 'Something went wrong.' } };
      }
    });

  // `check: false` only looks for the program; `check: true` also starts it to see the sign-in and models.
  handle('claude:status', async ({ check }) => {
    const executable = findClaude();
    if (check !== true || !executable) return { installed: Boolean(executable) };
    return checkClaude({ executable, options: base(), catalog });
  });

  // The full model list, once the check that `claude:status` started is done (null when none is running).
  handle('claude:models', async () => ((await catalog.pending()?.catch(() => null)) ?? null));

  handle('claude:request', async (payload, event) => {
    const request = checkRequest(payload);
    if (owners.has(request.id)) throw new ClaudeError('bad_request', 'That request isn’t valid.');
    const sender = event.sender;
    const send = message => {
      if (!sender.isDestroyed()) sender.send('claude:event', message);
    };
    owners.set(request.id, sender.id);
    sessions
      .run(request, partial => send({ id: request.id, type: 'update', content: partial.content, reasoning: partial.reasoning }))
      .then(
        reply => send({ id: request.id, type: 'done', reply }),
        error => send({ id: request.id, type: 'error', code: error.code ?? 'claude_failed', message: error.message }),
      )
      .finally(() => owners.delete(request.id));
  });

  handle('claude:abort', ({ id }, event) => {
    if (owners.get(String(id)) === event.sender.id) sessions.abort(String(id));
  });

  // Electron doesn't wait for promises here; the processes are ended at once and the transcripts swept on next use if this is cut short.
  app.on('will-quit', () => void sessions.closeAll());
  return { sessions };
}

module.exports = { setupClaude };
