'use strict';

// Tool servers (MCP) the person added. The list is a file of theirs, mcp.json in Quo's settings folder, opened in their
// own editor (ipc.js), in the shape other apps use, so a block from a server's instructions can be pasted in. Main reads
// it; the page never writes it and never sees a command, an argument or an environment value. A server runs only after
// the person approved exactly what it runs, in a native dialog; an entry that changes is off until approved again.

const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');

const NAME = /^[A-Za-z0-9_-]{1,32}$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const MAX_SERVERS = 20;
const LIMITS = { command: 1000, args: 100, arg: 4000, env: 50, value: 8000 };

const EXAMPLE = `{
  "mcpServers": {
  }
}
`;

/** One entry, checked: what to run, or why it can't be. */
function readEntry(name, entry) {
  if (!NAME.test(name)) return { name: String(name).slice(0, 32), problem: 'Give the server a short name of letters, digits, - or _.' };
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return { name, problem: 'This entry isn’t a list of settings.' };
  if (typeof entry.command !== 'string') {
    return { name, problem: entry.url ? 'Only tool servers that run on this computer (with a "command") work in Quo for now.' : 'This entry has no "command" to run.' };
  }
  const command = entry.command.trim();
  if (!command || command.length > LIMITS.command || command.includes('\0')) return { name, problem: 'The "command" is empty or too long.' };
  const args = entry.args ?? [];
  if (!Array.isArray(args) || args.length > LIMITS.args || !args.every(arg => typeof arg === 'string' && arg.length <= LIMITS.arg && !arg.includes('\0'))) {
    return { name, problem: '"args" must be a list of words.' };
  }
  const env = entry.env ?? {};
  if (typeof env !== 'object' || Array.isArray(env) || Object.keys(env).length > LIMITS.env) return { name, problem: '"env" must be a list of names and values.' };
  for (const [key, value] of Object.entries(env)) {
    if (!ENV_NAME.test(key) || typeof value !== 'string' || value.length > LIMITS.value || value.includes('\0')) return { name, problem: `The setting "${key.slice(0, 40)}" in "env" can’t be used.` };
  }
  const cwd = entry.cwd ?? null;
  if (cwd !== null && (typeof cwd !== 'string' || !path.isAbsolute(cwd))) return { name, problem: '"cwd" must be a full folder path.' };
  const sorted = Object.fromEntries(Object.entries(env).sort(([a], [b]) => a.localeCompare(b)));
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify([command, args, sorted, cwd])).digest('hex');
  return { name, command, args, env: sorted, cwd, disabled: entry.disabled === true, fingerprint };
}

/** The servers in the file (each checked), or why the file can't be read. A missing file is an empty list. */
async function readConfig(file) {
  let raw;
  try {
    raw = await fsp.readFile(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return { servers: [] };
    return { servers: [], problem: 'The tool servers file can’t be read.' };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { servers: [], problem: 'The tool servers file isn’t valid JSON. Check it for a missing comma or quote.' };
  }
  const list = parsed?.mcpServers ?? parsed?.servers;
  if (!list || typeof list !== 'object' || Array.isArray(list)) return { servers: [], problem: 'Put the servers under "mcpServers" in the file.' };
  const entries = Object.entries(list).slice(0, MAX_SERVERS);
  return { servers: entries.map(([name, entry]) => readEntry(name, entry)), ...(Object.keys(list).length > MAX_SERVERS ? { problem: `Only the first ${MAX_SERVERS} servers are used.` } : {}) };
}

/** Makes the file, empty, so there is something to open in an editor. Never overwrites one. */
async function ensureConfig(file) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, EXAMPLE, { flag: 'wx', mode: 0o600 }).catch(error => {
    if (error?.code !== 'EEXIST') throw error;
  });
}

/** What the person approved: per server, the fingerprint of what it runs and whether it is on. Main's own file. */
async function readApprovals(file) {
  try {
    const saved = JSON.parse(await fsp.readFile(file, 'utf8'));
    const servers = saved?.servers && typeof saved.servers === 'object' ? saved.servers : {};
    return Object.fromEntries(Object.entries(servers).filter(([name, value]) => NAME.test(name) && typeof value?.fingerprint === 'string').map(([name, value]) => [name, { fingerprint: value.fingerprint, on: value.on === true }]));
  } catch {
    return {};
  }
}

async function writeApprovals(file, approvals) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, JSON.stringify({ servers: approvals }, null, 2), { mode: 0o600 });
}

module.exports = { readConfig, readEntry, ensureConfig, readApprovals, writeApprovals, NAME, MAX_SERVERS };
