'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { AgentError, isSecretPath, resolveInside } = require('./safety');

/**
 * Opening something for the person in their own browser: a page the agent built, or a dev server it started. It is only
 * ever a project file of a kind a browser shows (never a program, a script or a shortcut: those would run), or an address
 * on this computer; the person approves each one (or for the session), and the agent never chooses what to open it with.
 */

// Things a browser draws. Not .sh, .exe, .desktop, .app, .jar or anything else the system would run.
const BROWSER_FILES = new Set(['.html', '.htm', '.xhtml', '.svg', '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif']);
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** What to open, checked: `{ what: 'url' | 'file', target (as shown), url (what is handed to the system) }`. */
function planOpen(ctx, input) {
  const target = String(input ?? '').trim();
  if (!target) throw new AgentError('bad_args', 'open_in_browser needs a file in the project, or a local address such as http://localhost:5173.');
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) && !/^[a-z]:[\\/]/i.test(target)) {
    let url;
    try {
      url = new URL(target);
    } catch {
      throw new AgentError('bad_args', 'That isn’t a valid address.');
    }
    if (!['http:', 'https:'].includes(url.protocol)) throw new AgentError('bad_url', 'Only http and https addresses on this computer can be opened.');
    if (!LOOPBACK.has(url.hostname)) throw new AgentError('bad_url', 'Only an address on this computer (localhost) can be opened, such as a dev server you started. For a web page, give the person the link instead.');
    if (url.username || url.password) throw new AgentError('bad_url', 'The address can’t hold a user name or password.');
    return { what: 'url', target: url.href, url: url.href };
  }
  const { absolute, relative } = resolveInside(ctx.rootReal, target);
  if (isSecretPath(relative)) throw new AgentError('secret', `${relative} looks like a secrets file, so Quo doesn’t open it.`);
  let stat;
  try {
    stat = fs.statSync(absolute);
  } catch {
    throw new AgentError('not_found', `There’s no file at ${relative}.`);
  }
  if (!stat.isFile()) throw new AgentError('not_file', `${relative} isn’t a file.`);
  const extension = path.extname(absolute).toLowerCase();
  if (!BROWSER_FILES.has(extension)) throw new AgentError('bad_type', `${relative} isn’t a kind of file a browser shows (${[...BROWSER_FILES].join(', ')}), so Quo won’t open it. Tell the person where it is instead.`);
  return { what: 'file', target: relative, url: pathToFileURL(absolute).href };
}

module.exports = { planOpen, BROWSER_FILES };
