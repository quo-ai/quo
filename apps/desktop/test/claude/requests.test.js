'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkRequest } = require('../../src/claude/validate');
const { PendingTools, toolHooks, toolServer } = require('../../src/claude/tools');
const { carryOn, contentFor, markOf } = require('../../src/claude/history');

const valid = (extra = {}) => ({ id: 'request-0001', model: 'sonnet', messages: [{ role: 'user', content: 'hi' }], ...extra });
const refused = raw => assert.throws(() => checkRequest(raw), error => ['bad_request', 'too_large'].includes(error.code));

test('a request is copied field by field: nothing in it reaches the program, its settings or its environment', () => {
  const clean = checkRequest(valid({ executable: '/tmp/evil', env: { NODE_OPTIONS: 'x' }, options: { permissionMode: 'bypassPermissions' }, cwd: '/' }));
  assert.deepEqual(Object.keys(clean).sort(), ['id', 'messages', 'model', 'oneOff', 'tools']);
  const message = checkRequest(valid({ messages: [{ role: 'user', content: 'hi', extra: 'x' }] })).messages[0];
  assert.deepEqual(message, { role: 'user', content: 'hi' });
});

test('model names that could be read as options or paths are refused', () => {
  for (const model of ['--dangerously-skip-permissions', '-p', '../claude', 'a b', 'opus;rm', '', 'x'.repeat(81)]) refused(valid({ model }));
  for (const model of ['sonnet', 'claude-opus-5-5', 'opus[1m]', 'default']) assert.equal(checkRequest(valid({ model })).model, model);
});

test('tools need plain names, an object schema and a description, and can’t repeat', () => {
  const fn = (name, parameters = { type: 'object' }) => ({ type: 'function', function: { name, description: 'd', parameters } });
  refused(valid({ tools: [fn('mcp:other')] }));
  refused(valid({ tools: [fn('Bash')] }));
  refused(valid({ tools: [fn('read_file', { type: 'string' })] }));
  refused(valid({ tools: [fn('read_file'), fn('read_file')] }));
  refused(valid({ tools: [{ type: 'function', function: { name: 'x', parameters: { type: 'object' } } }] }));
  assert.equal(checkRequest(valid({ tools: [fn('read_file')] })).tools[0].name, 'read_file');
});

test('malformed conversations and ids are refused', () => {
  refused(valid({ id: 'short' }));
  refused(valid({ messages: [] }));
  refused(valid({ messages: [{ role: 'developer', content: 'x' }] }));
  refused(valid({ messages: [{ role: 'tool', tool_call_id: '../x', content: 'x' }] }));
  refused(valid({ messages: [{ role: 'assistant', content: '', tool_calls: [{ id: 'a', function: { name: 'x', arguments: {} } }] }] }));
  refused(valid({ messages: [{ role: 'user', content: 'x'.repeat(17 * 1024 * 1024) }] }));
});

const rpcOf = server => {
  const replies = new Map();
  let id = 0;
  const transport = { async start() {}, async send(message) { replies.get(message.id)?.(message); } };
  const ready = server.instance.connect(transport);
  const call = (method, params) => new Promise(resolve => { replies.set(++id, resolve); transport.onmessage({ jsonrpc: '2.0', id, method, params }); });
  return { ready, call };
};

test('the tool server runs nothing: a call waits until Quo answers it, and an unoffered tool is refused', async () => {
  const pending = new PendingTools();
  const tools = [{ name: 'read_file', description: 'd'.repeat(3000), parameters: { type: 'object' } }];
  const { ready, call } = rpcOf(toolServer(tools, pending));
  await ready;
  const listed = await call('tools/list');
  assert.equal(listed.result.tools[0].description.length, 2048);
  assert.equal((await call('tools/call', { name: 'run_command' })).error.message, 'Unknown tool.');
  // Without the hook first, a call has no id to be answered by.
  assert.match((await call('tools/call', { name: 'read_file' })).error.message, /without saying which call/);

  const hooks = toolHooks(pending);
  pending.expect('toolu_1', 'mcp__quo__read_file');
  await hooks.PreToolUse[0].hooks[0]({ hook_event_name: 'PreToolUse', tool_use_id: 'toolu_1', tool_name: 'mcp__quo__read_file' });
  let answered = false;
  const held = call('tools/call', { name: 'read_file' }).then(reply => { answered = true; return reply; });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(answered, false, 'held until the result comes');
  pending.resolve('toolu_1', 'contents');
  assert.deepEqual((await held).result, { content: [{ type: 'text', text: 'contents' }], isError: false });
  assert.throws(() => pending.resolve('toolu_9', 'x'), /No tool call/);
});

test('history: a session carries on only from exactly what it saw, less earlier turns’ tool work', () => {
  const u1 = { role: 'user', content: 'one' };
  const calls = { role: 'assistant', content: '', tool_calls: [{ id: 't1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a"}' } }] };
  const result = { role: 'tool', tool_call_id: 't1', content: 'x' };
  const final = { role: 'assistant', content: 'Done  here.' };
  const seen = [u1, calls, result, final].map(markOf);
  assert.deepEqual(carryOn(seen, null, [u1, final, { role: 'user', content: 'two' }].map(markOf)), { kind: 'turn', start: 2 });
  assert.deepEqual(carryOn(seen, null, [u1, { role: 'assistant', content: 'Done here.' }, { role: 'user', content: 'two' }].map(markOf)), { kind: 'turn', start: 2 }, 'spacing differences don’t matter');
  assert.equal(carryOn(seen, null, [{ role: 'user', content: 'edited' }, final, { role: 'user', content: 'two' }].map(markOf)), null);
  assert.equal(carryOn(seen, null, seen.map((_, i) => [u1, calls, result, final][i]).map(markOf)), null, 'nothing new');

  const parked = [u1, calls].map(markOf);
  assert.deepEqual(carryOn(parked, ['t1'], [u1, calls, result].map(markOf)), { kind: 'results', start: 2, end: 3 });
  assert.equal(carryOn(parked, ['t1'], [u1, calls, { ...result, tool_call_id: 't2' }].map(markOf)), null);
  assert.equal(carryOn(parked, ['t1'], [u1, calls, result, final].map(markOf)), null, 'only the person’s messages may follow results');
});

test('history Claude missed is a labelled note, and the newest messages stay plain', () => {
  const blocks = contentFor([{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }]);
  assert.equal(blocks.length, 2);
  assert.match(blocks[0].text, /^<conversation-checkpoint>[\s\S]*<user>\na\n<\/user>\n<assistant>\nb\n<\/assistant>\n<\/conversation-checkpoint>$/);
  assert.deepEqual(blocks[1], { type: 'text', text: 'c' });
  assert.deepEqual(contentFor([{ role: 'user', content: ' ' }]), [{ type: 'text', text: '(empty message)' }]);
});

test('attached images: only data addresses of images reach Claude Code, as image blocks', () => {
  const image = 'data:image/jpeg;base64,' + 'A'.repeat(40);
  const clean = checkRequest(valid({ messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: image } }, { type: 'text', text: 'What is this?' }] }] }));
  assert.deepEqual(contentFor(clean.messages), [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'A'.repeat(40) } }, { type: 'text', text: 'What is this?' }]);
  for (const url of ['https://example.com/cat.jpg', 'data:text/html;base64,PGgx', 'file:///etc/passwd', 'data:image/jpeg;base64,not base64!']) {
    refused(valid({ messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url } }] }] }));
  }
  refused(valid({ messages: [{ role: 'user', content: Array.from({ length: 9 }, () => ({ type: 'image_url', image_url: { url: image } })) }] }));
  refused(valid({ messages: [{ role: 'assistant', content: [{ type: 'text', text: 'x' }] }] }));
  // In the labelled note of earlier history, an image is a mark, not data.
  const [note] = contentFor([...clean.messages, { role: 'assistant', content: 'A cat.' }, { role: 'user', content: 'thanks' }]);
  assert.match(note.text, /\[An image was attached here\.\]/);
  assert.equal(note.text.includes('AAAA'), false);
});
