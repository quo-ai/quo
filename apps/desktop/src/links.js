'use strict';

// Links that open Quo from outside (quo://), such as Hugging Face's "Use this model → Quo". One shape is understood:
//   quo://models/huggingface/<owner>/<name>[?file=<path>.gguf]
// It opens that model in Models & storage, with that file chosen if the repository has it. A link never downloads or
// runs anything: the person still picks a size and presses Add and download, and the download goes through the same
// checks as any other (Hugging Face only, exact sizes). Anything else is ignored.

const { app, ipcMain } = require('electron');
const { trusted } = require('./trust');

const SCHEME = 'quo';
/** One part of an owner/name repository id, as Hugging Face allows it; never "..", never encoded. */
const PART = /^(?!.*\.\.)[A-Za-z0-9][\w.-]{0,95}$/;
/** A file inside the repository: plain path parts, a .gguf at the end, nothing that climbs out. */
const FILE = /^(?!.*\.\.)(?![/.])[\w.\-/]{1,250}\.gguf$/i;

/** The model a link asks for, or null if it isn't a link Quo understands. */
function parseModelLink(href) {
  if (typeof href !== 'string' || href.length > 600) return null;
  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== `${SCHEME}:` || url.host !== 'models' || url.username || url.password || url.port || url.hash) return null;
  const parts = url.pathname.split('/');
  // ['', 'huggingface', owner, name], allowing one trailing slash.
  if (parts[parts.length - 1] === '' && parts.length === 5) parts.pop();
  if (parts.length !== 4 || parts[0] !== '' || parts[1] !== 'huggingface' || !PART.test(parts[2]) || !PART.test(parts[3])) return null;
  const keys = [...url.searchParams.keys()];
  if (keys.some(key => key !== 'file') || keys.length > 1) return null;
  const file = url.searchParams.get('file');
  if (file !== null && !FILE.test(file)) return null;
  return file ? { repo: `${parts[2]}/${parts[3]}`, file } : { repo: `${parts[2]}/${parts[3]}` };
}

/** The quo:// link among a program's arguments (Windows and Linux pass it that way), if any. */
const linkInArgs = argv => (Array.isArray(argv) ? argv.find(arg => typeof arg === 'string' && arg.startsWith(`${SCHEME}://`)) : undefined);

/**
 * Collects quo:// links from the start (macOS sends the one that opened the app through open-url, before the app is
 * ready; Windows and Linux pass it as an argument) and, once start() is called, makes Quo their handler (packaged builds
 * only, so a dev build never takes over the installed app's) and hands the model to the page, which asks with links:take.
 */
function setupLinks({ getWindow, focus, electron = { app, ipcMain }, argv = process.argv }) {
  const { app: host, ipcMain: ipc } = electron;
  let pending = null;
  let started = false;
  const receive = href => {
    const link = parseModelLink(href);
    if (!link) return;
    pending = link;
    if (!started) return; // the page takes it once it has loaded
    focus();
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send('links:open');
  };
  const fromArgs = argv => {
    const href = linkInArgs(argv);
    if (href) receive(href);
  };
  host.on('open-url', (event, url) => {
    event.preventDefault();
    receive(url);
  });
  fromArgs(argv);

  return {
    fromArgs,
    /** After the window is made. Links open models, so builds without the native engine ignore them. */
    start({ enabled }) {
      started = true;
      if (!enabled) {
        pending = null;
        return;
      }
      if (host.isPackaged) host.setAsDefaultProtocolClient(SCHEME);
      ipc.handle('links:take', event => {
        if (!trusted(event)) return { error: { code: 'untrusted', message: 'Not allowed.' } };
        const link = pending;
        pending = null;
        return { ok: link };
      });
    },
  };
}

module.exports = { SCHEME, parseModelLink, linkInArgs, setupLinks };
