'use strict';

// The Flathub build runs commands, git and tool servers on the computer through flatpak-spawn (src/flatpak.js). These
// tests try to abuse that: model-written arguments taken as flatpak-spawn's own options, the sandbox's or the
// person's secrets reaching a command, and commands that ignore signals outliving their time limit or Stop. A stand-in
// for flatpak-spawn (fake-flatpak-spawn.js) behaves as Flatpak's session helper does.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { describe, it, before, after } = require('node:test');
const flatpak = require('../src/flatpak');
const { runCommand } = require('../src/agent/exec');
const { gitEnv } = require('../src/agent/gitcmd');
const { scrubbedEnv } = require('../src/agent/safety');
const { tempDir } = require('./tempdir');

const unix = process.platform !== 'win32';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const alive = pid => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
async function gone(pids, ms = 3000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(50)) if (!pids.some(alive)) return true;
  return false;
}

/** Splits arguments as flatpak-spawn does: its options end at the first argument that doesn't start with "-". */
function asFlatpakSpawnReads(args) {
  let i = 0;
  while (i < args.length && args[i].startsWith('-')) i++;
  return { options: args.slice(0, i), command: args.slice(i) };
}

/** Runs forProject's result and collects what it printed. */
function run([file, args, options], { input } = {}) {
  return new Promise(resolve => {
    const child = spawn(file, args, { ...options, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', chunk => (out += chunk));
    child.stderr.on('data', chunk => (out += chunk));
    child.on('close', code => resolve({ code, out }));
    child.stdin.end(input ?? '');
  });
}

describe('flatpak-spawn arguments', () => {
  it('keeps every model-written argument after the program, where flatpak-spawn passes it on unread', () => {
    const tricks = ['--env=LD_PRELOAD=/tmp/evil.so', '--directory=/', '--sandbox', '--forward-fd=3', '-c', '$(touch pwned)'];
    const args = flatpak.hostArgs('git', ['add', '--', ...tricks], { cwd: '/home/me/project', env: { PATH: '/usr/bin' } });
    const { options, command } = asFlatpakSpawnReads(args);
    assert.deepEqual(options, ['--host', '--watch-bus', '--clear-env', '--directory=/home/me/project', '--env=PATH=/usr/bin']);
    assert.deepEqual(command, ['/bin/sh', '-c', flatpak.STOPPABLE, 'quo', 'git', 'add', '--', ...tricks]);
  });

  it('keeps a model-written folder name inside its one --directory argument', () => {
    const cwd = '/home/me/a b/--env=X=1/ /bin/sh';
    const { options } = asFlatpakSpawnReads(flatpak.hostArgs('ls', [], { cwd, env: {} }));
    assert.deepEqual(options.slice(3), [`--directory=${cwd}`]);
  });

  it('passes only plain variable names, never bash functions or names a shell would misread', () => {
    const env = { GOOD: 'yes', 'BASH_FUNC_ls%%': '() { rm -rf ~; }', 'A B': 'x', 'X=Y': 'z', '-n': 'x', NUL: 'a\0b', EMPTY: '' };
    const { options } = asFlatpakSpawnReads(flatpak.hostArgs('ls', [], { cwd: '/p', env }));
    assert.deepEqual(options.filter(o => o.startsWith('--env=')), ['--env=GOOD=yes', '--env=EMPTY=']);
  });

  it('gives flatpak-spawn itself only what it needs to reach Flatpak, and nothing of the person’s', () => {
    const env = flatpak.spawnerEnv({ DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/flatpak/bus', XDG_RUNTIME_DIR: '/run/user/1000', HOME: '/home/me', PATH: '/app/bin:/usr/bin', GITHUB_TOKEN: 'secret', OPENAI_API_KEY: 'secret', SSH_AUTH_SOCK: '/run/ssh' });
    assert.deepEqual(Object.keys(env).sort(), ['DBUS_SESSION_BUS_ADDRESS', 'HOME', 'PATH', 'XDG_RUNTIME_DIR']);
  });

  it('changes nothing outside Flatpak', () => {
    flatpak.reset();
    flatpak.config.detect = () => false;
    const options = { cwd: '/p', env: { A: '1' }, detached: true };
    assert.deepEqual(flatpak.forProject('git', ['status'], options), ['git', ['status'], options]);
    flatpak.reset();
  });

  it('refuses a shell: true spawn inside Flatpak (the command must be one /bin/sh -c argument)', () => {
    flatpak.reset();
    flatpak.config.detect = () => true;
    assert.throws(() => flatpak.forProject('ls; rm -rf ~', [], { shell: true }), /\/bin\/sh -c/);
    flatpak.reset();
  });
});

describe('the environment commands start from', () => {
  after(() => flatpak.reset());

  it('is the computer’s, read through Flatpak, then scrubbed like any other', () => {
    flatpak.reset();
    flatpak.config.detect = () => true;
    const raw = Buffer.from('PATH=/usr/local/bin:/usr/bin\0HOME=/home/me\0GITHUB_TOKEN=ghp_x\0AWS_SECRET_ACCESS_KEY=y\0SSH_AUTH_SOCK=/run/user/1000/ssh\0WITH=equals=inside\0');
    const host = flatpak.hostEnv({ exec: () => raw });
    assert.equal(host.WITH, 'equals=inside');
    assert.equal(flatpak.baseEnv(), host, 'read once');
    const commandEnv = scrubbedEnv(flatpak.baseEnv());
    assert.equal(commandEnv.PATH, '/usr/local/bin:/usr/bin');
    assert.equal(commandEnv.GITHUB_TOKEN, undefined);
    assert.equal(commandEnv.AWS_SECRET_ACCESS_KEY, undefined);
    assert.equal(commandEnv.SSH_AUTH_SOCK, undefined, 'model-written commands never get the agent sockets');
    assert.equal(gitEnv().SSH_AUTH_SOCK, '/run/user/1000/ssh', 'git for commits and pushes keeps the computer’s SSH agent');
  });

  it('falls back to a plain environment, and asks again, when Flatpak doesn’t answer', () => {
    flatpak.reset();
    flatpak.config.detect = () => true;
    const first = flatpak.hostEnv({ exec: () => { throw new Error('no permission'); } });
    assert.deepEqual(Object.keys(first).sort(), ['HOME', 'PATH']);
    assert.equal(flatpak.hostEnv({ exec: () => Buffer.from('PATH=/x\0') }).PATH, '/x');
  });
});

describe('commands on the computer, through a stand-in for flatpak-spawn', { skip: !unix && 'POSIX only' }, () => {
  const spawner = path.join(__dirname, 'fake-flatpak-spawn.js');
  let shim;
  before(() => {
    // An executable for config.spawner that runs the stand-in with this Node.
    shim = path.join(tempDir('quo-flatpak-bin-'), 'flatpak-spawn');
    fs.writeFileSync(shim, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(spawner)} "$@"\n`, { mode: 0o755 });
    flatpak.reset();
    flatpak.config.detect = () => true;
    flatpak.config.spawner = shim;
  });
  after(() => {
    flatpak.config.spawner = '/usr/bin/flatpak-spawn';
    flatpak.reset();
  });

  it('runs in the project folder with exactly the environment given, none of the sandbox’s', async () => {
    const dir = tempDir('quo-flatpak-');
    process.env.QUO_SANDBOX_ONLY = 'leaked';
    try {
      const result = await runCommand({ command: 'pwd; echo "${FOO:-none} ${QUO_SANDBOX_ONLY:-none}"', cwd: dir, env: { PATH: process.env.PATH, FOO: 'bar' } });
      assert.equal(result.exitCode, 0, result.output);
      assert.equal(result.output.trim(), `${dir}\nbar none`);
    } finally {
      delete process.env.QUO_SANDBOX_ONLY;
    }
  });

  it('passes option-like arguments to the program as they are', async () => {
    const tricks = ['--env=LD_PRELOAD=/tmp/evil.so', '--directory=/', '--host', '$(echo pwned)', 'a b'];
    const dir = tempDir('quo-flatpak-');
    const { code, out } = await run(flatpak.forProject('printf', ['%s\\n', ...tricks], { cwd: dir, env: { PATH: process.env.PATH } }));
    assert.equal(code, 0, out);
    assert.deepEqual(out.trimEnd().split('\n'), tricks);
  });

  it('keeps the exit code and the input (tool servers talk over it)', async () => {
    assert.equal((await run(flatpak.forProject('/bin/sh', ['-c', 'exit 7'], { env: { PATH: process.env.PATH } }))).code, 7);
    const echoed = await run(flatpak.forProject('cat', [], { env: { PATH: process.env.PATH } }), { input: '{"jsonrpc":"2.0"}\n' });
    assert.equal(echoed.out, '{"jsonrpc":"2.0"}\n');
  });

  it('kills a command that ignores signals, with everything it started, when its time is up', async () => {
    const dir = tempDir('quo-flatpak-');
    const command = 'trap "" INT TERM HUP; sleep 30 & echo $$ $! > pids; wait';
    const started = Date.now();
    const result = await runCommand({ command, cwd: dir, env: { PATH: process.env.PATH }, timeoutMs: 1500 });
    assert.equal(result.timedOut, true);
    assert.ok(Date.now() - started < 6000, `took ${Date.now() - started} ms: the command outlived its limit`);
    const pids = fs.readFileSync(path.join(dir, 'pids'), 'utf8').trim().split(' ').map(Number);
    assert.equal(pids.length, 2);
    assert.ok(await gone(pids), `still running: ${pids.filter(alive)}`);
  });

  it('kills it on Stop too', async () => {
    const dir = tempDir('quo-flatpak-');
    const stop = new AbortController();
    const running = runCommand({ command: 'trap "" INT TERM HUP; echo $$ > pid; sleep 30', cwd: dir, env: { PATH: process.env.PATH }, signal: stop.signal });
    for (let i = 0; i < 100 && !fs.existsSync(path.join(dir, 'pid')); i++) await sleep(30);
    const stopped = Date.now();
    stop.abort();
    const result = await running;
    assert.equal(result.aborted, true);
    assert.ok(Date.now() - stopped < 4000, `took ${Date.now() - stopped} ms to stop`);
    assert.ok(await gone([Number(fs.readFileSync(path.join(dir, 'pid'), 'utf8'))]));
  });

  it('stops a tool server’s whole group when it is closed (SIGTERM, as McpClient.close sends)', async () => {
    const dir = tempDir('quo-flatpak-');
    const [file, args, options] = flatpak.forProject('/bin/sh', ['-c', 'trap "" TERM INT; sleep 30 & echo $$ $! > pids; wait'], { cwd: dir, env: { PATH: process.env.PATH }, detached: true });
    const child = spawn(file, args, { ...options, stdio: 'ignore' });
    for (let i = 0; i < 100 && !fs.existsSync(path.join(dir, 'pids')); i++) await sleep(30);
    const pids = fs.readFileSync(path.join(dir, 'pids'), 'utf8').trim().split(' ').map(Number);
    process.kill(-child.pid, 'SIGTERM');
    assert.ok(await gone(pids), `still running: ${pids.filter(alive)}`);
  });
});
