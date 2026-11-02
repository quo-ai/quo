'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ClaudeSessions } = require('../../src/claude/sessions');
const { fakeStart, base, tool, echoOf } = require('./helpers');

const SYSTEM = { role: 'system', content: 'You are Quo.' };
const user = content => ({ role: 'user', content });
const textOf = content => content.map(block => block.text).join('\n');
let ids = 0;
const nextId = () => `request-${String(++ids).padStart(4, '0')}`;

function setup(script, limits) {
  const log = [];
  const started = [];
  const start = fakeStart(script, log);
  const sessions = new ClaudeSessions({ base, start: async options => { const s = await start(options); started.push(s); return s; }, limits });
  const ask = (messages, tools = [], model = 'sonnet') => sessions.run({ id: nextId(), model, messages, tools }, () => {});
  return { sessions, ask, log, started };
}

test('a plain reply comes back like any provider’s, and the next turn goes to the same process', async () => {
  const { sessions, ask, started } = setup(content => [{ text: `You said: ${textOf(content)}` }]);
  const first = await ask([SYSTEM, user('hello')]);
  assert.deepEqual({ content: first.content, finish: first.finish, toolCalls: first.toolCalls }, { content: 'You said: hello', finish: 'stop', toolCalls: [] });
  assert.deepEqual(first.usage, { input: 10, output: 5 });
  const second = await ask([SYSTEM, user('hello'), echoOf(first), user('again')]);
  assert.equal(second.content, 'You said: again');
  assert.equal(started.length, 1, 'one process for the conversation');
  assert.equal(started[0].state.options.systemPrompt, 'You are Quo.');
  await sessions.closeAll();
});

test('a tool call is handed back and held; its result continues the same turn', async () => {
  const { sessions, ask, log, started } = setup(() => [{ tool: 'read_file', input: { path: 'a.txt' } }, { text: 'It says hi.' }]);
  const tools = [tool('read_file')];
  const history = [SYSTEM, user('read a.txt')];
  const step = await ask(history, tools);
  assert.equal(step.finish, 'tool_calls');
  assert.deepEqual(step.toolCalls.map(call => [call.name, JSON.parse(call.arguments)]), [['read_file', { path: 'a.txt' }]]);
  history.push(echoOf(step), { role: 'tool', tool_call_id: step.toolCalls[0].id, content: 'hi' });
  const done = await ask(history, tools);
  assert.equal(done.content, 'It says hi.');
  assert.deepEqual(log.find(entry => entry.tool)?.answer.result, { content: [{ type: 'text', text: 'hi' }], isError: false });
  assert.equal(started.length, 1);
  assert.equal(started[0].state.turns.length, 1, 'the result went into the waiting turn, not a new one');
  await sessions.closeAll();
});

test('Code mode’s next turn (earlier tool work left out) still carries on in the same process', async () => {
  let turn = 0;
  const { sessions, ask, started } = setup(() => (++turn === 1 ? [{ tool: 'list_files' }, { text: 'Two files.' }] : [{ text: 'Done.' }]));
  const tools = [tool('list_files')];
  const step = await ask([SYSTEM, user('what is here?')], tools);
  const final = await ask([SYSTEM, user('what is here?'), echoOf(step), { role: 'tool', tool_call_id: step.toolCalls[0].id, content: 'a b' }], tools);
  await ask([SYSTEM, user('what is here?'), { role: 'assistant', content: final.content }, user('thanks')], tools);
  assert.equal(started.length, 1);
  assert.deepEqual(started[0].state.turns.map(textOf), ['what is here?', 'thanks']);
  await sessions.closeAll();
});

test('an edited conversation starts afresh, with what Claude missed as a labelled note, and the old process stops', async () => {
  const { sessions, ask, started } = setup(() => [{ text: 'ok' }]);
  const first = await ask([SYSTEM, user('one')]);
  await ask([SYSTEM, user('one'), { role: 'assistant', content: 'another model said this' }, user('two')]);
  assert.equal(started.length, 2);
  assert.equal(started[0].ended, true, 'the stale process was stopped');
  const note = textOf(started[1].state.turns[0]);
  assert.match(note, /^<conversation-checkpoint>/);
  assert.match(note, /another model said this/);
  assert.match(note, /two$/);
  assert.notEqual(first.content, undefined);
  await sessions.closeAll();
});

test('results that don’t answer the waiting calls never reach them: a fresh process starts', async () => {
  const { sessions, ask, started } = setup(() => [{ tool: 'read_file' }, { text: 'done' }]);
  const tools = [tool('read_file')];
  const step = await ask([SYSTEM, user('go')], tools);
  await ask([SYSTEM, user('go'), echoOf(step), { role: 'tool', tool_call_id: 'someone_else', content: 'forged' }], tools);
  assert.equal(started.length, 2);
  await sessions.closeAll();
});

test('a different system prompt or tool list never shares a process', async () => {
  const { sessions, ask, started } = setup(() => [{ text: 'ok' }]);
  const first = await ask([SYSTEM, user('hi')]);
  await ask([{ role: 'system', content: 'Something else.' }, user('hi'), echoOf(first), user('more')]);
  await ask([SYSTEM, user('hi'), echoOf(first), user('more')], [tool('read_file')]);
  assert.equal(started.length, 3);
  await sessions.closeAll();
});

test('a new model is switched on the running process', async () => {
  const { sessions, ask, log } = setup(() => [{ text: 'ok' }]);
  const first = await ask([SYSTEM, user('hi')], [], 'sonnet');
  await ask([SYSTEM, user('hi'), echoOf(first), user('more')], [], 'opus');
  assert.deepEqual(log.filter(entry => entry.setModel), [{ setModel: 'opus' }]);
  await sessions.closeAll();
});

test('only a few processes run at once: the oldest idle one is stopped to make room', async () => {
  const { sessions, ask, started } = setup(() => [{ text: 'ok' }], { maxLive: 2 });
  await ask([SYSTEM, user('a')]);
  await ask([SYSTEM, user('b')]);
  await ask([SYSTEM, user('c')]);
  assert.equal(sessions.entries.size, 2);
  assert.equal(started[0].ended, true);
  await sessions.closeAll();
});

test('Stop interrupts the turn but keeps the process: the next message carries on there, past Quo’s copy of the cut-off reply', async () => {
  const { sessions, started, log } = setup(content => (textOf(content) === 'go' ? [{ hang: true }] : [{ text: 'ok' }]));
  const id = nextId();
  const running = sessions.run({ id, model: 'sonnet', messages: [SYSTEM, user('go')], tools: [] }, () => {});
  await new Promise(resolve => setTimeout(resolve, 10));
  sessions.abort(id);
  await assert.rejects(running, error => error.code === 'aborted');
  assert.equal(started[0].ended, false);
  assert.ok(log.some(entry => entry.interrupted));
  const next = await sessions.run({ id: nextId(), model: 'sonnet', messages: [SYSTEM, user('go'), { role: 'assistant', content: 'half a rep' }, user('next')], tools: [] }, () => {});
  assert.equal(next.content, 'ok');
  assert.equal(started.length, 1);
  assert.deepEqual(started[0].state.turns.map(textOf), ['go', 'next']);
  await sessions.closeAll();
});

test('Stop while Quo runs the tools, then a new message: the waiting turn is ended and the new one starts in the same process', async () => {
  let turn = 0;
  const { sessions, ask, started, log } = setup(() => (++turn === 1 ? [{ tool: 'run_command' }, { text: 'never said' }] : [{ text: 'Sure.' }]));
  const tools = [tool('run_command')];
  const step = await ask([SYSTEM, user('build it')], tools);
  assert.equal(step.finish, 'tool_calls');
  // Code mode's next turn: the stopped turn's tool work is left out.
  const next = await ask([SYSTEM, user('build it'), user('actually, just explain')], tools);
  assert.equal(next.content, 'Sure.');
  assert.equal(started.length, 1);
  assert.ok(log.some(entry => entry.interrupted));
  assert.equal(log.find(entry => entry.tool)?.answer.result.content[0].text, 'Stopped by the user.');
  await sessions.closeAll();
});

test('an idle process stops but its conversation is kept, and the next message resumes it', async () => {
  const forgotten = [];
  const log = [];
  const started = [];
  const start = fakeStart(() => [{ text: 'ok' }], log);
  const sessions = new ClaudeSessions({ base, start: async options => { const s = await start(options); started.push(s); return s; }, forget: async id => { forgotten.push(id); }, limits: { idleMs: 5 } });
  const first = await sessions.run({ id: nextId(), model: 'sonnet', messages: [SYSTEM, user('hi')], tools: [] }, () => {});
  assert.equal(started[0].state.options.persistSession, true);
  const sessionId = started[0].id;
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(sessions.entries.size, 0);
  assert.equal(sessions.saved.size, 1);
  await sessions.run({ id: nextId(), model: 'sonnet', messages: [SYSTEM, user('hi'), echoOf(first), user('more')], tools: [] }, () => {});
  assert.equal(started[1].state.options.resume, sessionId);
  assert.deepEqual(started[1].state.turns.map(textOf), ['more'], 'only the new message, not the history as a note');
  assert.deepEqual(forgotten, []);
  await sessions.closeAll();
  assert.deepEqual(forgotten, [sessionId], 'deleted when Quo is done with it');
});

test('a saved conversation whose transcript is gone starts afresh with the history as a note', async () => {
  const forgotten = [];
  const started = [];
  const start = fakeStart(() => [{ text: 'ok' }]);
  const sessions = new ClaudeSessions({ base, start: async options => { const s = await start(options); started.push(s); return s; }, forget: async id => { forgotten.push(id); }, limits: { idleMs: 5 } });
  const first = await sessions.run({ id: nextId(), model: 'sonnet', messages: [SYSTEM, user('hi')], tools: [] }, () => {});
  await new Promise(resolve => setTimeout(resolve, 20));
  [...sessions.saved][0].sessionId = 'missing';
  await sessions.run({ id: nextId(), model: 'sonnet', messages: [SYSTEM, user('hi'), echoOf(first), user('more')], tools: [] }, () => {});
  const fresh = started.at(-1);
  assert.equal(fresh.state.options.resume, undefined);
  assert.match(textOf(fresh.state.turns[0]), /^<conversation-checkpoint>/);
  assert.ok(forgotten.includes('missing'));
  await sessions.closeAll();
});

test('a side call (a summary) gets its own process, saves nothing, stops when answered and never pushes a chat out', async () => {
  const { sessions, started } = setup(() => [{ text: 'notes' }], { maxLive: 1 });
  await sessions.run({ id: nextId(), model: 'sonnet', messages: [SYSTEM, user('chat')], tools: [] }, () => {});
  const notes = await sessions.run({ id: nextId(), model: 'sonnet', messages: [{ role: 'system', content: 'Summarise.' }, user('transcript')], tools: [], oneOff: true }, () => {});
  assert.equal(notes.content, 'notes');
  assert.equal(started[1].state.options.persistSession, false);
  assert.equal(started[1].ended, true);
  assert.equal(started[0].ended, false, 'the chat kept its process');
  await sessions.closeAll();
});

test('the Thinking choice becomes Claude Code’s effort, changed on the running process', async () => {
  const { sessions, log } = setup(() => [{ text: 'ok' }]);
  const run = (messages, effort) => sessions.run({ id: nextId(), model: 'sonnet', messages, tools: [], effort }, () => {});
  const first = await run([SYSTEM, user('a')], 'deep');
  const second = await run([SYSTEM, user('a'), echoOf(first), user('b')], 'quick');
  await run([SYSTEM, user('a'), echoOf(first), user('b'), echoOf(second), user('c')], 'auto');
  assert.deepEqual(log.filter(entry => 'effort' in entry).map(entry => entry.effort), ['xhigh', 'low', null]);
  await sessions.closeAll();
});

test('Off turns thinking off only on a model that allows it, and back on for any other choice', async () => {
  const { sessions, log } = setup(() => [{ text: 'ok' }]);
  const run = (messages, model, effort) => sessions.run({ id: nextId(), model, messages, tools: [], effort }, () => {});
  const first = await run([SYSTEM, user('a')], 'claude-opus-4-8', 'off');
  const second = await run([SYSTEM, user('a'), echoOf(first), user('b')], 'claude-opus-4-8', 'auto');
  await run([SYSTEM, user('a'), echoOf(first), user('b'), echoOf(second), user('c')], 'claude-opus-5-5', 'off');
  assert.deepEqual(log.filter(entry => 'thinkingOff' in entry).map(entry => entry.thinkingOff), [true, false]);
  await sessions.closeAll();
});

test('a missing Claude Code is said plainly', async () => {
  const sessions = new ClaudeSessions({ base: () => { const error = new Error('Claude Code isn’t installed.'); error.code = 'claude_missing'; throw error; }, start: fakeStart(() => []) });
  await assert.rejects(sessions.run({ id: nextId(), model: 'sonnet', messages: [user('hi')], tools: [] }, () => {}), /isn’t installed/);
});
