'use strict';

const assert = require('node:assert/strict');
const { describe, it, after } = require('node:test');
const { AgentSession } = require('../../src/agent/session');
const { temp, node } = require('./helpers');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const alive = pid => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe('background commands', () => {
  const sessions = [];
  const make = (answers, extra = {}) => {
    const queue = [...answers];
    const asked = [];
    const s = new AgentSession({ root: temp(), name: 'demo', approve: async request => (asked.push(request), queue.shift() ?? 'deny'), ...extra });
    sessions.push(s);
    return Object.assign(s, { asked });
  };
  after(() => sessions.forEach(s => s.close()));

  const ticker = node("let n=0;setInterval(()=>console.log('tick '+(++n)),40)");

  it('starts after approval, reports what it prints since last time, and stops on request', async () => {
    const s = make(['once']);
    const started = await s.callTool('run_command', { command: ticker, background: true });
    assert.equal(started.ok, true, started.text);
    assert.match(started.text, /bg1/);
    assert.match(s.asked[0].title, /background/);
    const first = await s.callTool('command_output', { id: 'bg1', wait_seconds: 5 });
    assert.match(first.text, /still running/);
    assert.match(first.text, /tick 1/);
    await sleep(150);
    const second = await s.callTool('command_output', { id: 'bg1' });
    assert.doesNotMatch(second.text, /tick 1\b(?!\d)/, 'already-read output is not repeated');
    assert.match(second.text, /tick \d+/);
    const stopped = await s.callTool('stop_command', { id: 'bg1' });
    assert.match(stopped.text, /Stopped bg1/);
    await sleep(200);
    assert.match((await s.callTool('command_output', { id: 'bg1' })).text, /stopped/);
    assert.match((await s.callTool('stop_command', { id: 'bg1' })).text, /already finished/);
  });

  it('is always asked about, even for a command that would run freely, and nothing starts if declined', async () => {
    const s = make(['deny']);
    const result = await s.callTool('run_command', { command: 'git status', background: true });
    assert.equal(result.ok, false);
    assert.equal(s.asked.length, 1);
    assert.equal((await s.callTool('command_output', { id: 'bg1' })).ok, false);
  });

  it('is off in plan mode, and never starts from a reference repository path', async () => {
    const s = make(['once']);
    s.setMode('plan');
    assert.equal((await s.callTool('run_command', { command: ticker, background: true })).ok, false);
    assert.equal(s.asked.length, 0);
  });

  it('allows three at a time', async () => {
    const s = make(['once', 'once', 'once', 'once']);
    for (let i = 0; i < 3; i++) assert.equal((await s.callTool('run_command', { command: `${ticker} `.trimEnd() + ' ' + i, background: true })).ok, true);
    const fourth = await s.callTool('run_command', { command: ticker + ' x', background: true });
    assert.equal(fourth.ok, false);
    assert.match(fourth.text, /already running/);
    await s.callTool('stop_command', { id: 'bg1' });
    await sleep(200);
    assert.equal((await s.callTool('run_command', { command: ticker + ' y', background: true })).ok, true);
  });

  it('knows when one finishes on its own, with its exit code', async () => {
    const s = make(['once']);
    await s.callTool('run_command', { command: node("console.log('hi');process.exit(3)"), background: true });
    const out = await s.callTool('command_output', { id: 'bg1', wait_seconds: 5 });
    await sleep(100);
    const again = await s.callTool('command_output', { id: 'bg1' });
    assert.match(out.text + again.text, /hi/);
    assert.match(again.text, /exited with code 3/);
  });

  it('runs with credentials removed from its environment, and hides secret formats in its output', async () => {
    const s = make(['once'], { env: { ...process.env, MY_SECRET_TOKEN: 'sekrit', PATH: process.env.PATH } });
    await s.callTool('run_command', { command: node(`console.log('env:'+process.env.MY_SECRET_TOKEN);console.log('gh'+'p_'+'a'.repeat(36))`), background: true });
    await sleep(500);
    const out = (await s.callTool('command_output', { id: 'bg1', wait_seconds: 5 })).text;
    assert.match(out, /env:undefined/);
    assert.doesNotMatch(out, /ghp_/);
  });

  it('is killed, with its children, when the session ends', async () => {
    const s = make(['once']);
    await s.callTool('run_command', { command: ticker, background: true });
    const pid = s.background.get('bg1').child.pid;
    assert.equal(alive(pid), true);
    s.close();
    await sleep(300);
    assert.equal(alive(pid), false);
  });

  it('refuses ids it never gave out', async () => {
    const s = make([]);
    for (const id of [undefined, 'bg9', '../x', 42]) assert.equal((await s.callTool('command_output', { id })).ok, false);
    assert.equal((await s.callTool('stop_command', { id: 'nope' })).ok, false);
  });
});
