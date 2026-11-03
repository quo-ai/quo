'use strict';

// Tool servers (src/mcp/): only what the person's own file lists, only after a native dialog approved exactly what runs,
// off again when the entry changes; the page never sees a command or a value; every call is asked about; what comes back
// is text with secrets redacted, within a limit; the server can't ask Quo for the model, folders or the person.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { after, describe, it } = require('node:test');
const { readConfig, readEntry, ensureConfig } = require('../../src/mcp/config');
const { McpManager, resultText } = require('../../src/mcp/manager');
const { callWithApproval } = require('../../src/mcp/approve');
const { launch } = require('../../src/mcp/client');
const { shapeRequest } = require('../../src/approval/request');
const { tempDir } = require('../tempdir');

const FAKE = path.join(__dirname, 'fake-server.js');
const fakeEntry = (extra = {}) => ({ command: process.execPath, args: [FAKE], env: { FAKE_SETTING: 'value-from-the-file' }, ...extra });
const managers = [];

function setup(servers, { env } = {}) {
  const dir = tempDir('quo-mcp-');
  const configFile = path.join(dir, 'mcp.json');
  fs.writeFileSync(configFile, JSON.stringify({ mcpServers: servers }));
  const manager = new McpManager({ configFile, approvalsFile: path.join(dir, 'mcp-approved.json'), version: '1.0.0', env: env ?? process.env });
  managers.push(manager);
  return { manager, configFile, dir };
}
after(() => managers.forEach(manager => manager.closeAll()));

describe('the tool servers file', () => {
  it('reads the shape other apps use, and says what is wrong with an entry instead of running it', async () => {
    const dir = tempDir('quo-mcp-');
    const file = path.join(dir, 'mcp.json');
    assert.deepEqual(await readConfig(file), { servers: [] }); // no file yet
    fs.writeFileSync(file, '{ "mcpServers": { "a": { "command": "npx" }, ');
    assert.match((await readConfig(file)).problem, /isn’t valid JSON/);
    fs.writeFileSync(file, JSON.stringify({ mcpServers: {
      github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_TOKEN: 'x' } },
      remote: { url: 'https://example.com/mcp' },
      'bad name!': { command: 'x' },
      words: { command: 'x', args: 'not a list' },
      settings: { command: 'x', env: { 'BAD-NAME': 'v' } },
      relative: { command: 'x', cwd: 'some/folder' },
    } }));
    const { servers } = await readConfig(file);
    assert.equal(servers[0].command, 'npx');
    assert.match(servers[0].fingerprint, /^[0-9a-f]{64}$/);
    assert.deepEqual(servers.slice(1).map(server => Boolean(server.problem)), [true, true, true, true, true]);
    assert.match(servers[1].problem, /run on this computer/);
  });

  it('gives an entry a new fingerprint whenever what it runs changes', () => {
    const base = readEntry('s', { command: 'npx', args: ['a'], env: { B: '1', A: '2' } });
    assert.equal(readEntry('s', { command: 'npx', args: ['a'], env: { A: '2', B: '1' } }).fingerprint, base.fingerprint); // same, in another order
    for (const changed of [{ command: 'npx', args: ['b'], env: { A: '2', B: '1' } }, { command: 'npx', args: ['a'], env: { A: '3', B: '1' } }, { command: 'node', args: ['a'], env: { A: '2', B: '1' } }, { command: 'npx', args: ['a'], env: { A: '2', B: '1' }, cwd: path.resolve('/tmp') }]) {
      assert.notEqual(readEntry('s', changed).fingerprint, base.fingerprint);
    }
  });

  it('is made empty for the editor, and never overwritten', async () => {
    const file = path.join(tempDir('quo-mcp-'), 'mcp.json');
    await ensureConfig(file);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { mcpServers: {} });
    fs.writeFileSync(file, '{"mcpServers":{"mine":{"command":"x"}}}');
    await ensureConfig(file);
    assert.match(fs.readFileSync(file, 'utf8'), /mine/);
  });
});

describe('a tool server', () => {
  it('runs only once the person approves it, and the page never sees what it runs', async () => {
    const { manager } = setup({ fake: fakeEntry() });
    await manager.load();
    assert.equal(manager.state().servers[0].state, 'off'); // listed, not running
    const asked = [];
    await manager.turnOn('fake', async entry => (asked.push(entry), false)); // "Cancel"
    assert.equal(manager.running.size, 0);
    assert.equal(asked[0].command, process.execPath); // the dialog is shown what runs
    await manager.turnOn('fake', async () => true);
    const state = manager.state();
    assert.equal(state.servers[0].state, 'on');
    assert.ok(state.servers[0].tools.some(tool => tool.name === 'echo'));
    const page = JSON.stringify(state);
    for (const hidden of [process.execPath, FAKE, 'value-from-the-file']) assert.equal(page.includes(hidden), false, hidden);
    assert.ok(manager.has('mcp__fake__echo'));
    assert.ok(manager.has('mcp__fake__what_was_I_told')); // names models accept
    assert.equal(JSON.stringify(manager.definitions()).includes('value-from-the-file'), false);
  });

  it('answers with text only: secrets redacted, pictures left out (said so), a limit, errors as results', async () => {
    const { manager } = setup({ fake: fakeEntry() });
    await manager.load();
    await manager.turnOn('fake', async () => true);
    assert.deepEqual(await manager.call('mcp__fake__echo', { text: 'hello' }), { ok: true, text: 'You said: hello', display: { kind: 'tool', server: 'fake', tool: 'echo' } });
    const leak = await manager.call('mcp__fake__leak', {});
    assert.equal(/gh[p]_A{36}/.test(leak.text), false);
    assert.match((await manager.call('mcp__fake__picture', {})).text, /A picture \(image\/png\) was left out[\s\S]*A caption/);
    const huge = await manager.call('mcp__fake__huge', {}, { maxChars: 10_000 });
    assert.ok(huge.text.length < 10_200 && /cut/.test(huge.text));
    assert.equal((await manager.call('mcp__fake__broken', {})).ok, false);
    assert.equal((await manager.call('mcp__fake__nothing_like_this', {})).ok, false);
  });

  it('gets none of Quo’s own secrets, only what its entry gives it', async () => {
    const env = { ...process.env, OPENROUTER_API_KEY: 'k', QUO_SESSION_SECRET: 's', FAKE_HOME_SETTING: 'ok' };
    const { manager } = setup({ fake: fakeEntry() }, { env });
    await manager.load();
    await manager.turnOn('fake', async () => true);
    const names = (await manager.call('mcp__fake__env', {})).text.split(',');
    assert.ok(names.includes('FAKE_SETTING') && names.includes('FAKE_HOME_SETTING'));
    assert.equal(names.includes('OPENROUTER_API_KEY') || names.includes('QUO_SESSION_SECRET'), false);
  });

  it('can’t ask Quo for the model or the person’s folders: only ping is answered', async () => {
    const { manager } = setup({ fake: fakeEntry() });
    await manager.load();
    await manager.turnOn('fake', async () => true);
    const answers = JSON.parse((await manager.call('mcp__fake__what_was_I_told', {})).text);
    assert.deepEqual(answers.map(answer => [answer.id, Boolean(answer.error)]), [[900, true], [901, true], [902, false]]);
  });

  it('is off again when its entry in the file changes, until approved again, and stops when turned off', async () => {
    const { manager, configFile } = setup({ fake: fakeEntry() });
    await manager.load();
    await manager.turnOn('fake', async () => true);
    const child = manager.running.get('fake').client.child;
    fs.writeFileSync(configFile, JSON.stringify({ mcpServers: { fake: fakeEntry({ args: [FAKE, '--something-else'] }) } }));
    await manager.load();
    assert.equal(manager.state().servers[0].state, 'changed');
    assert.equal(manager.has('mcp__fake__echo'), false);
    await new Promise(resolve => (child.exitCode !== null || child.signalCode !== null ? resolve() : child.once('exit', resolve)));
    let asked = 0;
    await manager.turnOn('fake', async () => (asked++, true));
    assert.equal(asked, 1);
    await manager.turnOff('fake');
    assert.equal(manager.running.size, 0);
    await manager.load(); // off stays off
    assert.equal(manager.running.size, 0);
  });

  it('says plainly when its program isn’t there', async () => {
    const { manager } = setup({ gone: { command: 'quo-no-such-program-here' } });
    await manager.load();
    await manager.turnOn('gone', async () => true);
    const server = manager.state().servers[0];
    assert.equal(server.state, 'error');
    assert.match(server.message, /wasn’t found|stopped/);
  });
});

describe('calling a tool server’s tool', () => {
  const fakeMcp = () => {
    const calls = [];
    return { calls, describe: name => (name === 'mcp__s__t' ? { server: 's', tool: 't' } : null), call: async (name, args) => (calls.push([name, args]), { ok: true, text: 'done', display: { kind: 'tool' } }) };
  };

  it('asks first in the approval window, runs nothing when refused, and remembers "for this session"', async () => {
    const mcp = fakeMcp();
    const allowed = new Set();
    const requests = [];
    const answers = ['deny', 'session'];
    const approve = async request => (requests.push(request), answers.shift());
    assert.equal((await callWithApproval({ mcp, name: 'mcp__s__t', args: { a: 1 }, approve, allowed })).ok, false);
    assert.equal(mcp.calls.length, 0);
    await callWithApproval({ mcp, name: 'mcp__s__t', args: { a: 2 }, approve, allowed });
    await callWithApproval({ mcp, name: 'mcp__s__t', args: { a: 3 }, approve, allowed });
    assert.equal(requests.length, 2);
    assert.equal(mcp.calls.length, 2);
    assert.ok(shapeRequest(requests[0]), 'the approval window can draw it');
    assert.match(shapeRequest(requests[0]).view.args, /"a": 1/);
  });

  it('asks at the "risky" level too (Quo can’t tell what a tool changes); only "all" skips asking', async () => {
    const mcp = fakeMcp();
    let asked = 0;
    const approve = async () => (asked++, 'once');
    await callWithApproval({ mcp, name: 'mcp__s__t', args: {}, approve, allowed: new Set(), level: 'risky' });
    await callWithApproval({ mcp, name: 'mcp__s__t', args: {}, approve, allowed: new Set(), level: 'all' });
    assert.equal(asked, 1);
  });

  it('refuses a name that isn’t a running tool, and any answer from the window but once or session', async () => {
    const mcp = fakeMcp();
    assert.equal((await callWithApproval({ mcp, name: 'mcp__s__other', args: {}, approve: async () => 'once', allowed: new Set() })).ok, false);
    assert.equal((await callWithApproval({ mcp, name: 'mcp__s__t', args: {}, approve: async () => 'yes please', allowed: new Set() })).ok, false);
    assert.equal(mcp.calls.length, 0);
  });

  it('is refused in plan mode, in a Code session', async () => {
    const { AgentSession } = require('../../src/agent/session');
    const session = new AgentSession({ root: tempDir('quo-mcp-project-'), name: 'p', approve: async () => 'once', repos: null, mcp: fakeMcp() });
    session.mode = 'plan';
    assert.equal((await session.callTool('mcp__s__t', {})).ok, false);
    session.mode = 'work';
    assert.equal((await session.callTool('mcp__s__t', {})).ok, true);
    session.close();
  });
});

describe('starting a server on Windows', () => {
  it('goes through cmd.exe for launchers like npx, with each word quoted as needed, and runs an .exe directly', () => {
    const viaCmd = launch('npx', ['-y', '@scope/server', 'C:\\My Files'], 'win32');
    assert.match(viaCmd.file, /cmd(\.exe)?$/i);
    assert.deepEqual(viaCmd.args.slice(0, 3), ['/d', '/s', '/c']);
    assert.equal(viaCmd.args[3], '"npx -y @scope/server "C:\\My Files""');
    assert.deepEqual(launch('C:\\Tools\\server.exe', ['a'], 'win32'), { file: 'C:\\Tools\\server.exe', args: ['a'], verbatim: false });
    assert.deepEqual(launch('npx', ['a'], 'linux'), { file: 'npx', args: ['a'], verbatim: false });
  });

  it('keeps a result’s words even when it has nothing else', () => {
    assert.equal(resultText({ content: [] }), '(The tool returned nothing.)');
    assert.equal(resultText({ structuredContent: { a: 1 } }), '{"a":1}');
  });
});
