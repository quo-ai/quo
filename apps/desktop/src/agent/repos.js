'use strict';

const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { unzipSync } = require('fflate');
const { AgentError, IGNORED_DIRS, isSecretPath } = require('./safety');

/**
 * Reference repositories: public GitHub projects the model can read to understand
 * how something is done. A repository is downloaded as a zip from GitHub's own
 * download host and unpacked here by our own code, never by git, so nothing in it
 * can run: no hooks, no filters, no links. Names are checked against traversal,
 * sizes and counts are capped, and the result is read-only. This is also the only
 * network access Code mode has, and the model controls nothing in the address but
 * an owner, a repository and a ref, all matched against strict patterns.
 */

const HOST = 'codeload.github.com';
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;
const REF_SEGMENT = /^[A-Za-z0-9._+-]{1,100}$/;

const LIMITS = {
  zipBytes: 120 * 1024 * 1024,
  unpackedBytes: 400 * 1024 * 1024,
  fileBytes: 2 * 1024 * 1024,
  files: 40_000,
  cacheBytes: 1536 * 1024 * 1024,
  maxAgeMs: 24 * 60 * 60 * 1000,
  timeoutMs: 90_000,
};

/** `owner/name` and an optional ref, checked and normalised; throws if they aren't plausible GitHub names. */
function parseRepo(input, ref) {
  const match = /^([^/\s]+)\/([^/\s]+)$/.exec(String(input ?? '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\/+$/, '').replace(/\.git$/i, ''));
  if (!match || !OWNER.test(match[1]) || !REPO.test(match[2]) || match[2] === '.' || match[2] === '..') {
    throw new AgentError('bad_repo', 'Use a public GitHub repository, as owner/name (for example facebook/react).');
  }
  const wanted = String(ref ?? '').trim() || 'HEAD';
  const segments = wanted.split('/');
  if (wanted.length > 100 || !segments.every(segment => REF_SEGMENT.test(segment) && segment !== '.' && segment !== '..')) {
    throw new AgentError('bad_ref', 'That branch, tag or commit name isn’t valid.');
  }
  return { owner: match[1], repo: match[2], ref: wanted, name: `${match[1]}/${match[2]}` };
}

const slug = ref => ref.replace(/[^A-Za-z0-9._-]+/g, '_');

class RepoCache {
  constructor({ directory, fetchFn = globalThis.fetch, limits = {}, now = () => Date.now() }) {
    this.directory = directory;
    this.fetch = fetchFn;
    this.limits = { ...LIMITS, ...limits };
    this.now = now;
    this.indexFile = path.join(directory, 'index.json');
  }

  async readIndex() {
    try {
      return JSON.parse(await fsp.readFile(this.indexFile, 'utf8'));
    } catch {
      return {};
    }
  }

  async writeIndex(index) {
    await fsp.mkdir(this.directory, { recursive: true });
    await fsp.writeFile(this.indexFile, JSON.stringify(index));
  }

  /** The repository, downloaded if it isn't here yet (or is a day old). Returns where it is and what's in it. */
  async open(input, ref) {
    const target = parseRepo(input, ref);
    const key = `${target.owner}/${target.repo}@${slug(target.ref)}`.toLowerCase();
    const folder = path.join(this.directory, ...key.replace('@', '/').split('/').map(part => part.replace(/[^a-z0-9._-]/g, '_')));
    const index = await this.readIndex();
    const known = index[key];
    const fresh = known && (this.now() - known.at < this.limits.maxAgeMs || /^[0-9a-f]{40}$/i.test(target.ref));
    if (!(fresh && (await fsp.stat(folder).then(s => s.isDirectory(), () => false)))) {
      const bytes = await this.download(target, folder);
      index[key] = { folder, bytes, at: this.now() };
    } else index[key].at = this.now();
    await this.evict(index, key);
    await this.writeIndex(index);
    return { ...target, root: folder, ...(await this.summarise(folder)) };
  }

  async download(target, folder) {
    const url = `https://${HOST}/${target.owner}/${target.repo}/zip/${target.ref}`;
    const data = await this.fetchZip(url);
    const stage = `${folder}.tmp-${crypto.randomBytes(4).toString('hex')}`;
    try {
      const bytes = await this.unpack(data, stage);
      await fsp.rm(folder, { recursive: true, force: true });
      await fsp.mkdir(path.dirname(folder), { recursive: true });
      await fsp.rename(stage, folder);
      return bytes;
    } catch (error) {
      await fsp.rm(stage, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  async fetchZip(url) {
    let response;
    try {
      response = await this.fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(this.limits.timeoutMs), headers: { 'user-agent': 'Quo-Code' } });
      if (response.status >= 300 && response.status < 400) {
        const next = new URL(response.headers.get('location') ?? '', url);
        if (next.protocol !== 'https:' || next.hostname !== HOST) throw new AgentError('bad_redirect', 'GitHub sent the download somewhere unexpected, so Quo stopped.');
        response = await this.fetch(next, { redirect: 'error', signal: AbortSignal.timeout(this.limits.timeoutMs), headers: { 'user-agent': 'Quo-Code' } });
      }
    } catch (error) {
      if (error instanceof AgentError) throw error;
      throw new AgentError('offline', 'Couldn’t reach GitHub. Check the connection and try again.');
    }
    if (response.status === 404) throw new AgentError('repo_not_found', 'That repository, branch or tag wasn’t found. It must be public.');
    if (response.status === 403 || response.status === 429) throw new AgentError('rate_limited', 'GitHub is limiting downloads right now. Try again later.');
    if (!response.ok || !response.body) throw new AgentError('download_failed', `GitHub answered ${response.status}.`);
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > this.limits.zipBytes) throw new AgentError('too_large', 'That repository is too large to download.');
    const chunks = [];
    let size = 0;
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > this.limits.zipBytes) {
        await reader.cancel().catch(() => {});
        throw new AgentError('too_large', 'That repository is too large to download.');
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  }

  /** Unpacks the zip into `stage`: regular text-sized files only, names checked, totals capped. */
  async unpack(data, stage) {
    const accepted = [];
    let total = 0;
    let count = 0;
    // First pass: read only the table of contents (returning false inflates nothing).
    unzipSync(new Uint8Array(data), {
      filter: file => {
        count++;
        if (count > this.limits.files * 4) throw new AgentError('too_large', 'That repository has too many files.');
        const relative = cleanName(file.name);
        if (relative && !file.name.endsWith('/') && file.originalSize <= this.limits.fileBytes && !isSecretPath(relative) && !relative.split('/').some(part => IGNORED_DIRS.has(part) && part !== 'build' && part !== 'dist')) {
          accepted.push({ name: file.name, relative });
          total += file.originalSize;
        }
        return false;
      },
    });
    if (accepted.length > this.limits.files) throw new AgentError('too_large', 'That repository has too many files.');
    if (total > this.limits.unpackedBytes) throw new AgentError('too_large', 'That repository is too large to unpack.');
    const wanted = new Map(accepted.map(entry => [entry.name, entry.relative]));
    const files = unzipSync(new Uint8Array(data), { filter: file => wanted.has(file.name) });
    await fsp.mkdir(stage, { recursive: true });
    let written = 0;
    for (const [name, bytes] of Object.entries(files)) {
      const relative = wanted.get(name);
      const target = path.join(stage, ...relative.split('/'));
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, bytes, { flag: 'wx' });
      written += bytes.length;
    }
    return written;
  }

  async summarise(folder) {
    const entries = (await fsp.readdir(folder, { withFileTypes: true })).sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    const top = entries.slice(0, 40).map(entry => (entry.isDirectory() ? `${entry.name}/` : entry.name));
    const readme = entries.find(entry => /^readme(\.[a-z]+)?$/i.test(entry.name) && entry.isFile());
    let excerpt = '';
    if (readme) excerpt = (await fsp.readFile(path.join(folder, readme.name), 'utf8').catch(() => '')).slice(0, 1500);
    return { top, excerpt };
  }

  /** Keeps the cache under its size limit by dropping the longest-unused repositories (never the one just opened). */
  async evict(index, keep) {
    let total = Object.values(index).reduce((sum, entry) => sum + (entry.bytes ?? 0), 0);
    const oldest = Object.entries(index).filter(([key]) => key !== keep).sort((a, b) => a[1].at - b[1].at);
    while (total > this.limits.cacheBytes && oldest.length) {
      const [key, entry] = oldest.shift();
      await fsp.rm(entry.folder, { recursive: true, force: true }).catch(() => {});
      total -= entry.bytes ?? 0;
      delete index[key];
    }
  }

  async clear() {
    await fsp.rm(this.directory, { recursive: true, force: true });
  }
}

/** A zip entry's name as a path inside the repository: the top folder GitHub adds is dropped, and anything unsafe becomes null. */
function cleanName(name) {
  if (name.includes('\\') || name.includes('\0') || name.startsWith('/') || /^[A-Za-z]:/.test(name)) return null;
  const segments = name.split('/');
  segments.shift();
  if (segments.length === 0 || segments.some(segment => segment === '' || segment === '.' || segment === '..' || /[<>:"|?*\x00-\x1f]/.test(segment) || /[. ]$/.test(segment))) return null;
  return segments.join('/');
}

module.exports = { RepoCache, parseRepo, cleanName, LIMITS };
