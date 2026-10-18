'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * What keeps Code mode inside its lane. Everything the model asks for goes
 * through here first: which files it may touch, what counts as a secret, what
 * a command it runs can see. Nothing in this file talks to the network or the
 * user; it only decides.
 */

class AgentError extends Error {
  constructor(code, message) {
    super(message ?? code);
    this.code = code;
  }
}

const inside = relative => relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));

/**
 * Resolves a path the model gave (relative to the project, or absolute but inside
 * it) to a real path inside the project, or throws. Symlinks are followed before
 * the check, so a link in the project that points outside it is outside. With
 * `allowMissing`, the file may not exist yet (it must still sit in a folder that
 * is inside the project).
 */
function resolveInside(rootReal, input, { allowMissing = false } = {}) {
  const raw = String(input ?? '.').trim() || '.';
  if (raw.includes('\0')) throw new AgentError('bad_path', 'That path isn’t valid.');
  const candidate = path.resolve(rootReal, raw);
  if (!inside(path.relative(rootReal, candidate))) throw new AgentError('outside_project', 'That path is outside the project folder.');

  let real;
  try {
    real = fs.realpathSync.native(candidate);
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw new AgentError('not_readable', 'That path can’t be read.');
    if (!allowMissing) throw new AgentError('not_found', `There’s no file or folder at ${toPosix(path.relative(rootReal, candidate)) || '.'}.`);
    // Walk up to the nearest folder that exists, and check that one.
    const missing = [];
    let parent = candidate;
    for (;;) {
      missing.unshift(path.basename(parent));
      parent = path.dirname(parent);
      try {
        real = path.join(fs.realpathSync.native(parent), ...missing);
        break;
      } catch {
        if (parent === path.dirname(parent)) throw new AgentError('not_found', 'That folder doesn’t exist.');
      }
    }
  }
  const relative = path.relative(rootReal, real);
  if (!inside(relative)) throw new AgentError('outside_project', 'That path leads outside the project folder.');
  return { absolute: real, relative: toPosix(relative) || '.' };
}

const toPosix = value => value.split(path.sep).join('/');

const SECRET_DIRS = new Set(['.git', '.ssh', '.aws', '.gnupg', '.kube', '.docker']);
const SECRET_EXTENSIONS = new Set(['.pem', '.key', '.p12', '.pfx', '.jks', '.keystore', '.ppk']);
const SECRET_NAMES = new Set([
  '.npmrc', '.pypirc', '.netrc', '.git-credentials', '.htpasswd', '.dockercfg',
  'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519',
  'credentials', 'credentials.json', 'secrets.json', 'secrets.yml', 'secrets.yaml', 'service-account.json',
]);
const ENV_EXAMPLES = /\.(example|sample|template|dist|defaults?)$/;

/** Files Quo never reads, searches or writes: keys, credentials, .env files, anything inside .git. */
function isSecretPath(relativePosix) {
  const segments = String(relativePosix).toLowerCase().split('/').filter(Boolean);
  if (segments.some(segment => SECRET_DIRS.has(segment))) return true;
  const name = segments[segments.length - 1] ?? '';
  if (name === '.env' || (name.startsWith('.env.') && !ENV_EXAMPLES.test(name))) return true;
  if (SECRET_NAMES.has(name)) return true;
  return SECRET_EXTENSIONS.has(path.extname(name));
}

/** Folders searches and listings skip: dependencies, build output, caches. */
const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', '.next', '.nuxt', '.turbo', '.cache', '__pycache__', '.venv', 'venv',
  'target', 'dist', 'build', 'coverage', '.gradle', 'Pods', '.idea',
]);

const looksBinary = buffer => buffer.subarray(0, 8192).includes(0);

const REDACTIONS = [
  [/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, '[private key removed]'],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, '[access key removed]'],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, '[token removed]'],
  [/\bgithub_pat_[A-Za-z0-9_]{50,}\b/g, '[token removed]'],
  [/\bsk-(?:ant-|or-v1-|proj-)?[A-Za-z0-9_-]{32,}\b/g, '[key removed]'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, '[token removed]'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, '[key removed]'],
];

/** Removes well-known secret formats (private keys, cloud and API tokens) from text on its way to the model. */
function redactSecrets(text) {
  let result = text;
  for (const [pattern, replacement] of REDACTIONS) result = result.replace(pattern, replacement);
  return result;
}

const SENSITIVE_ENV = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|COOKIE|SESSION|AUTH)/i;
const SENSITIVE_PREFIXES = ['AWS_', 'AZURE_', 'GOOGLE_', 'GCP_', 'GH_', 'GITHUB_', 'NPM_CONFIG_', 'OPENROUTER', 'ANTHROPIC', 'OPENAI', 'SSH_', 'GPG_'];

/** The environment a command runs with: the ordinary one, minus anything that looks like a credential. */
function scrubbedEnv(env = process.env) {
  const kept = {};
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) continue;
    const upper = name.toUpperCase();
    if (SENSITIVE_ENV.test(name) || SENSITIVE_PREFIXES.some(prefix => upper.startsWith(prefix))) continue;
    kept[name] = value;
  }
  return kept;
}

/** Folders Code mode won't take as a project: too broad to be one project, or the system's own. */
function checkProjectRoot(rootReal, home = os.homedir()) {
  const parsed = path.parse(rootReal);
  const homeReal = (() => {
    try {
      return fs.realpathSync.native(home);
    } catch {
      return home;
    }
  })();
  const same = (a, b) => (process.platform === 'win32' || process.platform === 'darwin' ? a.toLowerCase() === b.toLowerCase() : a === b);
  if (same(rootReal, parsed.root)) throw new AgentError('too_broad', 'Choose a project folder, not a whole drive.');
  if (same(rootReal, homeReal) || inside(path.relative(rootReal, homeReal)) && !same(rootReal, homeReal)) {
    throw new AgentError('too_broad', 'Choose a project folder, not your whole home folder.');
  }
  // The system's own folders are off limits with everything under them; a few shared ones (/var, /usr, /private)
  // only as themselves, because people keep real projects below them (/var/www/site).
  const tree = process.platform === 'win32'
    ? [process.env.SystemRoot ?? 'C:\\Windows', process.env.ProgramFiles ?? 'C:\\Program Files', process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)']
    : ['/bin', '/boot', '/dev', '/etc', '/lib', '/lib64', '/proc', '/sbin', '/sys', '/System', '/Library'];
  const exact = process.platform === 'win32' ? [] : ['/usr', '/var', '/root', '/run', '/private', '/Applications', '/opt', '/srv', '/home', '/Users', '/mnt', '/media', '/tmp'];
  if (tree.some(directory => same(rootReal, directory) || inside(path.relative(directory, rootReal))) || exact.some(directory => same(rootReal, directory))) {
    throw new AgentError('system_folder', 'That’s a system folder. Choose your own project folder.');
  }
  return rootReal;
}

module.exports = { AgentError, resolveInside, isSecretPath, IGNORED_DIRS, looksBinary, redactSecrets, scrubbedEnv, checkProjectRoot, inside, toPosix };
