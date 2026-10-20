'use strict';

/**
 * What the approval window may be told, and which answers it may give. Everything the model influenced (a path, a diff, a
 * command, a commit message) arrives here as text and leaves as text, clipped, in a fixed shape: the window draws it with
 * textContent, never as markup, so nothing in it can pretend to be a button.
 */

const LIMITS = { title: 200, short: 300, label: 120, diff: 60_000, command: 4000, message: 4000, files: 50, commits: 30 };
const KINDS = new Set(['edit', 'command', 'commit', 'push', 'read', 'open', 'folder']);

const text = (value, max) => (typeof value === 'string' ? (value.length > max ? `${value.slice(0, max)}…` : value) : '');
const count = value => (Number.isFinite(value) && value >= 0 ? Math.min(Math.floor(value), 1e9) : 0);

/** The request as the window sees it, or null if it isn't one we know how to draw (the caller then uses the plain dialog). */
function shapeRequest(request) {
  if (!request || typeof request !== 'object' || !KINDS.has(request.kind) || typeof request.title !== 'string') return null;
  const view = request.view && typeof request.view === 'object' ? request.view : null;
  if (!view || view.kind !== request.kind) return null;
  const shaped = {
    kind: request.kind,
    title: text(request.title, LIMITS.title),
    project: text(request.project, LIMITS.label),
    rememberLabel: request.rememberLabel ? text(request.rememberLabel, LIMITS.label) : '',
  };
  if (request.kind === 'edit') {
    shaped.view = { kind: 'edit', action: ['create', 'edit', 'replace'].includes(view.action) ? view.action : 'edit', file: text(view.file, LIMITS.short), added: count(view.added), removed: count(view.removed), diff: text(view.diff, LIMITS.diff) };
  } else if (request.kind === 'command') {
    shaped.view = { kind: 'command', command: text(view.command, LIMITS.command), background: view.background === true, warning: text(view.warning, LIMITS.short) };
  } else if (request.kind === 'commit') {
    shaped.view = {
      kind: 'commit',
      branch: text(view.branch, LIMITS.short),
      author: text(view.author, LIMITS.short),
      files: (Array.isArray(view.files) ? view.files : []).slice(0, LIMITS.files).map(file => text(file, LIMITS.short)),
      message: text(view.message, LIMITS.message),
      credit: view.credit ? text(view.credit, LIMITS.short) : '',
    };
  } else if (request.kind === 'push') {
    shaped.view = {
      kind: 'push',
      remote: text(view.remote, LIMITS.short),
      url: text(view.url, LIMITS.short),
      branch: text(view.branch, LIMITS.short),
      remoteBranch: text(view.remoteBranch, LIMITS.short),
      count: count(view.count),
      commits: (Array.isArray(view.commits) ? view.commits : []).slice(0, LIMITS.commits).map(line => text(line, LIMITS.short)),
      newBranch: view.newBranch === true,
      toDefault: view.toDefault === true,
      defaultBranch: text(view.defaultBranch, LIMITS.short),
    };
  } else if (request.kind === 'folder') {
    shaped.view = { kind: 'folder', mode: view.mode === 'new' ? 'new' : 'existing', name: text(view.name, LIMITS.short), where: text(view.where, LIMITS.short) };
  } else if (request.kind === 'open') {
    shaped.view = { kind: 'open', what: view.what === 'url' ? 'url' : 'file', target: text(view.target, LIMITS.short) };
  } else {
    shaped.view = { kind: 'read', folder: text(view.folder, LIMITS.short) };
  }
  return shaped;
}

/** The answer to give back for what the window sent: only one of the offered choices, never anything else. */
function normalizeChoice(request, choice) {
  if (choice === 'once') return 'once';
  if (choice === 'session' && request.rememberLabel) return 'session';
  return 'deny';
}

module.exports = { shapeRequest, normalizeChoice, LIMITS };
