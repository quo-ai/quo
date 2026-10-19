'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AgentError, checkProjectRoot, inside, isSecretPath, toPosix } = require('./safety');

/**
 * Looking at something outside the project: a sibling folder in a monorepo, a shared config, another checkout. The model
 * gives an absolute path to a reading tool and the person approves that folder in a native dialog, once or for the session.
 * It is the same idea as opencode's "external directory" permission, with stricter edges:
 *
 *  - read-only: the changing tools never take these paths, only `resolveInside` against the project;
 *  - the approved folder becomes the root of its own context, so everything that confines a project (symlinks that lead
 *    out, secrets files, binary and size limits) confines it too, and files read there can't be edited;
 *  - never a system folder, a whole drive, or the home folder (`checkProjectRoot`), and never a path through a secrets
 *    folder (`.ssh`, `.aws`, `.git`…), judged on the full path, not only inside the approved folder;
 *  - at most a few folders at a time, and the page never supplies a path to the dialog: it shows what the model asked for.
 */

const MAX_ROOTS = 5;

class ExternalReads {
  constructor({ rootReal, approve, context }) {
    this.rootReal = rootReal;
    this.approve = approve;
    this.context = context; // () => the limits a project context has (shorter pages for a small model)
    this.roots = new Map(); // approved folder -> its own context
  }

  /** The context and the path inside it for an absolute path outside the project, or null for anything else. */
  async resolve(input) {
    if (typeof input !== 'string' || input === '') return null;
    const raw = input.startsWith('~/') ? path.join(os.homedir(), input.slice(2)) : input;
    if (!path.isAbsolute(raw)) return null;
    let real;
    try {
      real = fs.realpathSync.native(raw);
    } catch {
      throw new AgentError('not_found', 'There’s no file or folder at that path.');
    }
    if (inside(path.relative(this.rootReal, real))) return null; // inside the project: the ordinary rules
    if (isSecretPath(toPosix(real))) throw new AgentError('secret', 'That path goes through a folder with keys or credentials (or a .git folder), so Quo doesn’t read it.');
    const directory = fs.statSync(real).isDirectory() ? real : path.dirname(real);
    try {
      checkProjectRoot(directory);
    } catch {
      throw new AgentError('too_broad', 'Quo doesn’t read system folders, whole drives or your whole home folder. Name a more specific folder.');
    }
    const approved = [...this.roots.keys()].find(root => inside(path.relative(root, directory)));
    let root = approved;
    if (!root) {
      if (this.roots.size >= MAX_ROOTS) throw new AgentError('too_many', `Quo is already reading in ${MAX_ROOTS} folders outside the project. Work in the project, or ask the person to add the other folder as a project.`);
      const answer = await this.approve({
        kind: 'read',
        title: 'Let Quo read files in this folder?',
        detail: `${directory}\n\nIt is outside the project. Quo can list, read and search there, and never change anything. Keys, credentials and .env files stay unreadable.`,
        rememberLabel: 'Allow reading here for this session',
      });
      if (answer !== 'once' && answer !== 'session') throw new AgentError('denied', 'The person didn’t allow reading there. Don’t ask again; work in the project, or ask them what they’d like.');
      root = directory;
      if (answer === 'session') this.roots.set(root, { ...this.context(), rootReal: root, reads: new Map() });
    }
    const ctx = this.roots.get(root) ?? { ...this.context(), rootReal: root, reads: new Map() };
    return { ctx, path: toPosix(path.relative(root, real)) || '.', root };
  }
}

module.exports = { ExternalReads, MAX_ROOTS };
