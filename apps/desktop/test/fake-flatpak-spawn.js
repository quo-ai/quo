'use strict';

// Stands in for `flatpak-spawn --host` in tests (test/flatpak.test.js), the way Flatpak's session helper runs a host
// command: flatpak-spawn's own options only up to the first argument that doesn't start with "-"; the command in a new
// session (its own process group) in --directory, with only the --env variables after --clear-env; SIGTERM passed on
// to the command and SIGINT to its group; and with --watch-bus, the group interrupted (SIGINT) when this process dies,
// however it dies.

const os = require('node:os');
const { spawn } = require('node:child_process');

const argv = process.argv.slice(2);
const options = { env: {}, clear: false, directory: process.cwd(), watch: false };
let i = 0;
for (; i < argv.length && argv[i].startsWith('-'); i++) {
  const option = argv[i];
  if (option === '--host') continue;
  if (option === '--watch-bus') options.watch = true;
  else if (option === '--clear-env') options.clear = true;
  else if (option.startsWith('--directory=')) options.directory = option.slice('--directory='.length);
  else if (option.startsWith('--env=')) {
    const pair = option.slice('--env='.length);
    const at = pair.indexOf('=');
    options.env[pair.slice(0, at)] = pair.slice(at + 1);
  } else {
    process.stderr.write(`fake flatpak-spawn: unknown option ${option}\n`);
    process.exit(2);
  }
}
const command = argv.slice(i);
const env = { ...(options.clear ? {} : process.env), ...options.env };
const child = spawn(command[0], command.slice(1), { cwd: options.directory, env, detached: true, stdio: 'inherit' });

if (options.watch) {
  const watcher = `
    const [parent, group] = process.argv.slice(1).map(Number);
    const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
    setInterval(() => {
      if (!alive(group)) process.exit(0);
      if (!alive(parent)) {
        try { process.kill(-group, 'SIGINT'); } catch {}
        process.exit(0);
      }
    }, 50);`;
  spawn(process.execPath, ['-e', watcher, String(process.pid), String(child.pid)], { detached: true, stdio: 'ignore' }).unref();
}

const send = (pid, signal) => {
  try {
    process.kill(pid, signal);
  } catch {
    // Already gone.
  }
};
process.on('SIGTERM', () => send(child.pid, 'SIGTERM'));
process.on('SIGINT', () => send(-child.pid, 'SIGINT'));
child.on('error', error => {
  process.stderr.write(`fake flatpak-spawn: ${error.message}\n`);
  process.exit(1);
});
child.on('exit', (code, signal) => process.exit(code ?? 128 + (os.constants.signals[signal] ?? 0)));
