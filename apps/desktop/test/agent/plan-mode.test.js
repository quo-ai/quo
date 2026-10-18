'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { AgentSession, PLAN_TOOLS, TOOL_NAMES } = require('../../src/agent/session');
const { temp, write } = require('./helpers');

describe('plan mode', () => {
  const session = root => {
    const approvals = [];
    return { agent: new AgentSession({ root, name: 'demo', approve: async request => (approvals.push(request), 'once') }), approvals };
  };

  it('reads and searches as usual', async () => {
    const root = temp();
    write(root, 'a.txt', 'hello');
    const { agent } = session(root);
    agent.setMode('plan');
    assert.equal((await agent.callTool('read_file', { path: 'a.txt' })).ok, true);
    assert.equal((await agent.callTool('list_directory', {})).ok, true);
    assert.equal((await agent.callTool('search_text', { pattern: 'hello' })).ok, true);
  });

  it('changes and runs nothing, and doesn’t even ask, even when everything is allowed', async () => {
    const root = temp();
    write(root, 'a.txt', 'hello');
    const { agent, approvals } = session(root);
    await agent.callTool('read_file', { path: 'a.txt' });
    agent.setMode('plan');
    for (const [name, args] of [['edit_file', { path: 'a.txt', old_string: 'hello', new_string: 'bye' }], ['write_file', { path: 'b.txt', content: 'x' }], ['run_command', { command: 'node --version' }]]) {
      const result = await agent.callTool(name, args);
      assert.equal(result.ok, false, name);
      assert.match(result.text, /Plan mode is on/);
    }
    assert.equal(approvals.length, 0);
    assert.equal(require('node:fs').readFileSync(`${root}/a.txt`, 'utf8'), 'hello');
  });

  it('can be switched off again, and only to a known mode', async () => {
    const root = temp();
    const { agent } = session(root);
    agent.setMode('plan');
    agent.setMode('work');
    assert.equal((await agent.callTool('write_file', { path: 'b.txt', content: 'x' })).ok, true);
    assert.throws(() => agent.setMode('yolo'), error => error.code === 'bad_args');
    assert.equal(agent.mode, 'work');
  });

  it('offers only reading tools', () => {
    assert.ok(PLAN_TOOLS.every(name => TOOL_NAMES.includes(name)));
    for (const name of ['edit_file', 'write_file', 'run_command']) assert.ok(!PLAN_TOOLS.includes(name));
  });
});
