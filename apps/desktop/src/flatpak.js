'use strict';

const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

/**
 * Quo from Flathub runs inside Flatpak's sandbox. What a person's project needs (their shell, git, compilers, tool
 * servers) is on the computer outside it, so Code mode's commands, git and tool servers run there through
 * `flatpak-spawn --host` (the manifest's --talk-name=org.freedesktop.Flatpak), as they do outside Flatpak: after the
 * same approvals, in the same folder, with the same scrubbed environment and limits. The engines and everything else
 * Quo runs itself stay inside.
 *
 * flatpak-spawn reads its own options only up to the first argument that doesn't start with "-". So each option is one
 * `--name=value` argument, the program after them is always /bin/sh, and everything the caller passes comes after it as
 * the shell's positional arguments: a file name or argument the model wrote can't become an option. The command gets
 * exactly the environment it is given (--clear-env), never the sandbox's.
 *
 * Stopping: flatpak-spawn passes SIGTERM on to the program, and when it is killed itself Flatpak interrupts the
 * program's process group (--watch-bus). STOPPABLE turns either into SIGKILL for the whole group, so a command that
 * ignores them still stops, as killTree does outside Flatpak.
 */

const config = {
  spawner: '/usr/bin/flatpak-spawn',
  detect: () => process.platform === 'linux' && fs.existsSync('/.flatpak-info'),
};

let flatpak;
/** Whether this is the Flathub build, running inside Flatpak's sandbox. */
function inFlatpak() {
  if (flatpak === undefined) flatpak = config.detect() === true;
  return flatpak;
}

/**
 * Runs "$@" in the background so that `wait` can be interrupted, with its input passed on (a shell gives a background
 * command /dev/null otherwise; tool servers talk over it). INT, TERM or HUP kill the whole process group.
 */
const STOPPABLE = 'trap \'trap - INT TERM HUP; kill -s KILL 0\' INT TERM HUP; exec 3<&0; "$@" <&3 3<&- & wait $!';

/** What flatpak-spawn itself needs inside the sandbox: the session bus to reach Flatpak, and nothing of the person's. */
const SPAWNER_ENV = ['DBUS_SESSION_BUS_ADDRESS', 'XDG_RUNTIME_DIR', 'HOME', 'PATH', 'LANG', 'LC_ALL'];
function spawnerEnv(env = process.env) {
  const kept = {};
  for (const name of SPAWNER_ENV) if (typeof env[name] === 'string') kept[name] = env[name];
  return kept;
}

/** A name every shell reads as one plain variable. Others (bash's exported functions among them) are left out. */
const PLAIN_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** flatpak-spawn's arguments to run `file args` on the computer in `cwd` with exactly `env`. */
function hostArgs(file, args, { cwd, env }) {
  if (typeof file !== 'string' || !file) throw new TypeError('A program to run is needed.');
  const options = ['--host', '--watch-bus', '--clear-env', `--directory=${cwd || os.homedir()}`];
  for (const [name, value] of Object.entries(env ?? {})) {
    if (typeof value !== 'string' || !PLAIN_NAME.test(name) || value.includes('\0')) continue;
    options.push(`--env=${name}=${value}`);
  }
  return [...options, '/bin/sh', '-c', STOPPABLE, 'quo', file, ...args];
}

/**
 * spawn()/execFile() arguments for something run for the person's project: unchanged outside Flatpak, and on the
 * computer through flatpak-spawn inside it. flatpak-spawn itself starts in "/" with only what it needs.
 * @returns {[string, string[], object]}
 */
function forProject(file, args, options = {}) {
  if (!inFlatpak()) return [file, args, options];
  const { cwd, env, shell, ...rest } = options;
  if (shell) throw new TypeError('Pass a shell command as /bin/sh -c.');
  return [config.spawner, hostArgs(file, args, { cwd, env }), { ...rest, cwd: '/', env: spawnerEnv() }];
}

/** The NUL-separated environment of a process (/proc/<pid>/environ) as an object. */
function parseEnviron(raw) {
  const env = {};
  for (const entry of String(raw).split('\0')) {
    const at = entry.indexOf('=');
    if (at > 0) env[entry.slice(0, at)] = entry.slice(at + 1);
  }
  return env;
}

let host;
/**
 * The computer's own environment, as an app started from its menu gets it (the Flatpak session helper's), read once.
 * The sandbox's would be wrong outside it: its PATH, XDG folders and runtime paths are Flatpak's.
 */
function hostEnv({ exec = execFileSync } = {}) {
  if (host) return host;
  try {
    const raw = exec(config.spawner, ['--host', '--watch-bus', 'cat', '/proc/self/environ'], { cwd: '/', env: spawnerEnv(), timeout: 10_000, maxBuffer: 1024 * 1024 });
    host = parseEnviron(raw);
  } catch {
    // Flatpak didn't answer: a plain environment for now, and ask again next time.
    return { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: os.homedir() };
  }
  return host;
}

/** The environment that commands, git and tool servers start from, before scrubbing: the computer's, also in Flatpak. */
function baseEnv() {
  return inFlatpak() ? hostEnv() : process.env;
}

/** For tests: forget what was detected and read. */
function reset() {
  flatpak = undefined;
  host = undefined;
}

module.exports = { inFlatpak, forProject, hostArgs, hostEnv, baseEnv, parseEnviron, spawnerEnv, STOPPABLE, config, reset };
