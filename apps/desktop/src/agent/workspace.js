'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const { AgentError, inside } = require('./safety');

/**
 * A folder for a new project, made by the app itself. When someone asks Quo to build something and has no folder, it makes
 * an empty one under Documents/Quo Projects, named from the request, and works there. The page only supplies words to
 * name it with; where it goes, and what is allowed in the name, is decided here: lowercase letters, digits and hyphens,
 * made with a plain mkdir that fails if the name is taken (so it can never reuse, or write through, something that is
 * already there). A cap stops a runaway page from filling the disk with folders.
 */

const MAX_NAME = 40;
const MAX_FOLDERS = 200;
const MAX_TRIES = 99;

/** "Build me a Todo app!" → "build-me-a-todo-app". Never empty, never starting with a dot or hyphen. */
function slugOf(raw) {
  const slug = String(raw ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_NAME)
    .replace(/-+$/g, '');
  return slug || 'project';
}

/** Makes `<parent>/<slug>` (or `<slug>-2`, `-3`…) and returns its real path. */
async function createWorkspace(parent, rawName) {
  await fsp.mkdir(parent, { recursive: true });
  const parentReal = await fsp.realpath(parent);
  const existing = await fsp.readdir(parentReal).catch(() => []);
  if (existing.length >= MAX_FOLDERS) throw new AgentError('too_many', `There are already ${MAX_FOLDERS} folders in Quo Projects. Remove some, or choose a folder yourself.`);
  const slug = slugOf(rawName);
  for (let n = 1; n <= MAX_TRIES; n++) {
    const target = path.join(parentReal, n === 1 ? slug : `${slug}-${n}`);
    try {
      await fsp.mkdir(target); // fails if anything, even a link, is already there
    } catch (error) {
      if (error.code === 'EEXIST') continue;
      throw new AgentError('failed', 'Couldn’t create the project folder.');
    }
    const real = await fsp.realpath(target);
    if (!inside(path.relative(parentReal, real)) || real === parentReal) throw new AgentError('failed', 'Couldn’t create the project folder.');
    return real;
  }
  throw new AgentError('failed', 'Couldn’t find a free name for the project folder.');
}

/**
 * A new folder the model asked for: the person approves it first, naming where it will go. Nothing is made if they say no.
 * `approve` is the approval window; `label` is how the place is shown (Documents/Quo Projects).
 */
async function createApproved(parent, rawName, approve, label = 'Documents/Quo Projects') {
  const slug = slugOf(rawName);
  const answer = await approve({
    kind: 'folder',
    title: 'Make a folder for this?',
    detail: `${label}/${slug}`,
    view: { kind: 'folder', mode: 'new', name: slug, where: label },
  });
  if (answer !== 'once' && answer !== 'session') throw new AgentError('denied', 'The person didn’t want a folder made. Carry on without one, and say what you can do here.');
  return createWorkspace(parent, rawName);
}

module.exports = { createWorkspace, createApproved, slugOf, MAX_FOLDERS };
