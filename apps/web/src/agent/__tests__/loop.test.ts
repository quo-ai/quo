import { describe, expect, it } from 'vitest';
import { describeDone, describeRunning } from '../describe';
import { CONTEXT_CHARS, MAX_STEPS, estimateTokens, parseArguments, runAgent, trimToolOutput, type AgentDeps } from '../loop';
import type { AgentMessage, StepReply, ToolResult } from '../types';

const reply = (patch: Partial<StepReply> = {}): StepReply => ({ content: '', toolCalls: [], finish: 'stop', charged: 0.5, balance: 20, ...patch });
const call = (id: string, name: string, args: unknown) => ({ id, name, arguments: typeof args === 'string' ? args : JSON.stringify(args) });
const user: AgentMessage[] = [{ role: 'user', content: 'Fix the bug' }];

/** A model that says what it's told to, one reply per question, remembering what it was asked. */
function script(replies: StepReply[], tools: Record<string, ToolResult | ((args: Record<string, unknown>) => ToolResult)> = {}) {
  const asked: AgentMessage[][] = [];
  const ran: { name: string; args: Record<string, unknown> }[] = [];
  const updates: { steps: { title: string; status: string }[]; text: string }[] = [];
  const controller = new AbortController();
  const deps: AgentDeps = {
    signal: controller.signal,
    askModel: async (messages, onText) => {
      asked.push(messages);
      const next = replies[asked.length - 1] ?? reply();
      if (next.content) onText(next.content);
      return next;
    },
    runTool: async (name, args) => {
      ran.push({ name, args });
      const result = tools[name] ?? { ok: true, text: `${name} done`, display: { kind: 'list', entries: 3 } };
      return typeof result === 'function' ? result(args) : result;
    },
    onUpdate: state => updates.push(state),
  };
  return { deps, asked, ran, updates, controller };
}

describe('the agent loop', () => {
  it('answers straight away when the model needs no tools', async () => {
    const { deps, asked, ran } = script([reply({ content: 'It is a React app.' })]);
    const outcome = await runAgent(user, deps);
    expect(outcome.text).toBe('It is a React app.');
    expect(outcome.steps).toEqual([]);
    expect(asked).toHaveLength(1);
    expect(ran).toEqual([]);
    expect(outcome).toMatchObject({ stopped: false, limited: false, charged: 0.5, balance: 20 });
  });

  it('runs the tools the model asks for, tells it what happened, and goes round again', async () => {
    const { deps, asked, ran } = script(
      [
        reply({ content: 'Let me look.', toolCalls: [call('c1', 'read_file', { path: 'a.js' })], finish: 'tool_calls' }),
        reply({ toolCalls: [call('c2', 'edit_file', { path: 'a.js', old_string: 'x', new_string: 'y' })], finish: 'tool_calls' }),
        reply({ content: 'Fixed it.' }),
      ],
      {
        read_file: { ok: true, text: 'a.js (lines 1-1 of 1)\n1\tx', display: { kind: 'read', path: 'a.js', from: 1, to: 1, total: 1 } },
        edit_file: { ok: true, text: 'Edited a.js (+1 −1).', display: { kind: 'edit', path: 'a.js', added: 1, removed: 1, diff: '-x\n+y' } },
      },
    );
    const outcome = await runAgent(user, deps);
    expect(ran.map(r => r.name)).toEqual(['read_file', 'edit_file']);
    expect(outcome.text).toBe('Fixed it.');
    expect(outcome.charged).toBeCloseTo(1.5);
    expect(outcome.steps.map(s => s.status)).toEqual(['done', 'done']);
    expect(outcome.steps[0].text).toBe('Let me look.'); // what it said before acting stays with the step
    expect(outcome.steps[1].detail).toEqual({ kind: 'diff', body: '-x\n+y' });
    // The second question to the model carries its own call and the tool's answer.
    expect(asked[1].map(m => m.role)).toEqual(['user', 'assistant', 'tool']);
    expect(asked[1][2]).toEqual({ role: 'tool', tool_call_id: 'c1', content: 'a.js (lines 1-1 of 1)\n1\tx' });
    expect(asked[2].map(m => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant', 'tool']);
  });

  it('shows each step while it runs, then as it finishes', async () => {
    const { deps, updates } = script([reply({ toolCalls: [call('c1', 'run_command', { command: 'npm test' })], finish: 'tool_calls' }), reply({ content: 'Tests pass.' })], {
      run_command: { ok: true, text: 'ok', display: { kind: 'command', command: 'npm test', exitCode: 0, output: '3 passed' } },
    });
    await runAgent(user, deps);
    const titles = updates.map(u => u.steps[0]?.title).filter(Boolean);
    expect(titles[0]).toBe('Running npm test…');
    expect(titles.at(-1)).toBe('Ran npm test (OK)');
    expect(updates.find(u => u.steps[0]?.status === 'running')).toBeDefined();
  });

  it('handles several tool calls in one reply, in order', async () => {
    const { deps, ran, asked } = script([
      reply({ toolCalls: [call('a', 'list_directory', {}), call('b', 'read_file', { path: 'x' })], finish: 'tool_calls' }),
      reply({ content: 'Done.' }),
    ]);
    const outcome = await runAgent(user, deps);
    expect(ran.map(r => r.name)).toEqual(['list_directory', 'read_file']);
    expect(outcome.steps).toHaveLength(2);
    expect(asked[1].filter(m => m.role === 'tool').map(m => m.role === 'tool' && m.tool_call_id)).toEqual(['a', 'b']);
  });

  it('turns a refused change into something the model can read, and carries on', async () => {
    const { deps } = script(
      [reply({ toolCalls: [call('c1', 'edit_file', { path: 'a.js', old_string: 'x', new_string: 'y' })], finish: 'tool_calls' }), reply({ content: 'Understood. What would you prefer?' })],
      { edit_file: { ok: false, text: 'The user didn’t allow that change.', display: { kind: 'edit', path: 'a.js', denied: true } } },
    );
    const outcome = await runAgent(user, deps);
    expect(outcome.steps[0]).toMatchObject({ status: 'declined', title: 'You declined the change to a.js' });
    expect(outcome.text).toMatch(/What would you prefer/);
  });

  it('answers the model itself when its arguments aren’t valid, without running anything', async () => {
    const { deps, ran, asked } = script([reply({ toolCalls: [call('c1', 'read_file', '{"path": "a.js"')], finish: 'tool_calls' }), reply({ content: 'Sorry, retrying.' })]);
    const outcome = await runAgent(user, deps);
    expect(ran).toEqual([]);
    expect(outcome.steps[0].status).toBe('failed');
    const echoed = asked[1][1];
    expect(echoed.role === 'assistant' && echoed.tool_calls?.[0].function.arguments).toBe('{}'); // sent back as valid JSON, or the server would refuse it
    expect(asked[1][2]).toMatchObject({ role: 'tool', content: expect.stringMatching(/valid JSON/) });
  });

  it('stops when told to, mid-tool, without asking the model again or running more tools', async () => {
    const { deps, asked, ran, controller } = script([reply({ toolCalls: [call('a', 'run_command', { command: 'sleep 60' }), call('b', 'read_file', { path: 'x' })], finish: 'tool_calls' })]);
    deps.runTool = async (name, args) => {
      ran.push({ name, args });
      controller.abort();
      return { ok: true, text: 'was stopped', display: { kind: 'command', command: 'sleep 60', aborted: true, exitCode: null } };
    };
    const outcome = await runAgent(user, deps);
    expect(outcome.stopped).toBe(true);
    expect(ran.map(r => r.name)).toEqual(['run_command']);
    expect(asked).toHaveLength(1);
    expect(outcome.steps[0].status).toBe('stopped');
  });

  it('stops when told to before the model has answered, keeping what it was charged', async () => {
    const { deps, controller } = script([reply({ content: 'half an answer', charged: 2 })]);
    deps.askModel = async () => {
      controller.abort();
      throw new Error('aborted');
    };
    expect(await runAgent(user, deps)).toMatchObject({ stopped: true, steps: [] });
  });

  it('lets a real error through (no credits, no connection) for the screen to explain', async () => {
    const { deps } = script([]);
    deps.askModel = async () => {
      throw Object.assign(new Error('no credits'), { code: 'insufficient_credits' });
    };
    await expect(runAgent(user, deps)).rejects.toMatchObject({ code: 'insufficient_credits' });
  });

  it('gives up after the step limit, and says so', async () => {
    const forever = Array.from({ length: 10 }, (_, i) => reply({ toolCalls: [call(`c${i}`, 'list_directory', {})], finish: 'tool_calls' }));
    const { deps, asked } = script(forever);
    const outcome = await runAgent(user, { ...deps, maxSteps: 3 });
    expect(outcome.limited).toBe(true);
    expect(outcome.text).toMatch(/stopped after 3 steps/);
    expect(asked).toHaveLength(3);
    expect(MAX_STEPS).toBeGreaterThanOrEqual(20);
  });
});

describe('models reached with the user’s own key', () => {
  it('adds up the tokens used over the whole turn, and charges nothing', async () => {
    const { deps } = script([
      reply({ toolCalls: [call('c1', 'list_directory', {})], charged: 0, balance: null, usage: { input: 100, output: 10 } }),
      reply({ content: 'Done.', charged: 0, balance: null, usage: { input: 150, output: 20 } }),
    ]);
    const outcome = await runAgent(user, deps);
    expect(outcome.usage).toEqual({ input: 250, output: 30 });
    expect(outcome.charged).toBe(0);
    expect(outcome.balance).toBeNull();
  });

  it('has no token count when the provider gave none', async () => {
    const { deps } = script([reply({ content: 'Hi.' })]);
    expect((await runAgent(user, deps)).usage).toBeNull();
  });

  it('sends less of a long conversation to a model with a smaller window', async () => {
    const big = 'x'.repeat(20_000);
    const { deps, asked } = script([
      ...Array.from({ length: 8 }, (_, i) => reply({ toolCalls: [call(`c${i}`, 'read_file', { path: `f${i}` })] })),
      reply({ content: 'Done.' }),
    ], { read_file: { ok: true, text: big, display: { kind: 'read', from: 1, to: 1, total: 1 } } });
    await runAgent(user, { ...deps, contextChars: 60_000 });
    const sent = asked.at(-1)!.filter(m => m.role === 'tool').map(m => m.content);
    expect(sent.length).toBe(8);
    expect(sent.filter(content => content.startsWith('[Earlier output left out')).length).toBeGreaterThan(0);
    expect(sent.reduce((sum, content) => sum + content.length, 0)).toBeLessThan(60_000 + 20_000);
  });
});

describe('keeping a long session within bounds', () => {
  const tool = (id: string, size: number): AgentMessage => ({ role: 'tool', tool_call_id: id, content: 'x'.repeat(size) });
  const assistant = (id: string): AgentMessage => ({ role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name: 'read_file', arguments: '{}' } }] });

  it('leaves a short conversation alone', () => {
    const messages: AgentMessage[] = [...user, assistant('a'), tool('a', 1000)];
    expect(trimToolOutput(messages)).toBe(messages);
  });

  it('drops the oldest tool output first, keeps the calls, and keeps the latest results', () => {
    const messages: AgentMessage[] = [...user];
    for (let i = 0; i < 12; i++) messages.push(assistant(`c${i}`), tool(`c${i}`, 60_000));
    const trimmed = trimToolOutput(messages, CONTEXT_CHARS);
    expect(trimmed).toHaveLength(messages.length);
    const results = trimmed.filter(m => m.role === 'tool');
    expect(results.slice(0, 3).every(m => m.content.startsWith('[Earlier output left out'))).toBe(true);
    expect(results.slice(-6).every(m => m.content.length === 60_000)).toBe(true);
    expect(trimmed.filter(m => m.role === 'assistant')).toEqual(messages.filter(m => m.role === 'assistant'));
    const total = trimmed.reduce((sum, m) => sum + m.content.length, 0);
    expect(total).toBeLessThanOrEqual(CONTEXT_CHARS + 60_000);
  });

  it('does not touch what it was given', () => {
    const messages: AgentMessage[] = [...user];
    for (let i = 0; i < 12; i++) messages.push(assistant(`c${i}`), tool(`c${i}`, 60_000));
    const before = JSON.stringify(messages);
    trimToolOutput(messages);
    expect(JSON.stringify(messages)).toBe(before);
  });
});

describe('arguments from the model', () => {
  it('are objects, or nothing usable', () => {
    expect(parseArguments('{"a":1}')).toEqual({ a: 1 });
    expect(parseArguments('')).toEqual({});
    expect(parseArguments('  ')).toEqual({});
    for (const bad of ['[1]', '"text"', '5', 'null', '{"a":', 'nope']) expect(parseArguments(bad), bad).toBeNull();
  });
});

describe('describing steps', () => {
  const done = (tool: string, args: Record<string, unknown>, result: Partial<ToolResult>) => describeDone(tool, args, { ok: true, text: '', ...result });

  it('says what is happening, before the person has said yes', () => {
    expect(describeRunning('read_file', { path: 'src/a.ts' })).toBe('Reading src/a.ts…');
    expect(describeRunning('read_file', { path: 'README.md', repo: 'a/b' })).toBe('Reading a/b/README.md…');
    expect(describeRunning('edit_file', { path: 'a.ts' })).toBe('Waiting for your OK to edit a.ts…');
    expect(describeRunning('run_command', { command: 'npm test' })).toBe('Running npm test…');
    expect(describeRunning('open_repo', { repo: 'facebook/react' })).toBe('Downloading facebook/react…');
    expect(describeRunning('mystery', {})).toBe('Working (mystery)…');
  });

  it('says what was done', () => {
    expect(done('read_file', { path: 'a.ts' }, { display: { kind: 'read', from: 1, to: 80, total: 200 } }).title).toBe('Read a.ts, lines 1–80 of 200');
    expect(done('search_text', {}, { display: { kind: 'search', pattern: 'foo', matches: 1, files: 1 } }).title).toBe('Searched for “foo”: 1 match in 1 file');
    expect(done('find_files', {}, { display: { kind: 'find', pattern: '*.ts', matches: 4 } }).title).toBe('Found 4 files matching *.ts');
    expect(done('list_directory', { path: 'src' }, { display: { kind: 'list', entries: 1 } }).title).toBe('Looked in src (1 item)');
    expect(done('edit_file', {}, { display: { kind: 'edit', path: 'a.ts', added: 2, removed: 1, diff: '-a\n+b' } })).toMatchObject({ title: 'Edited a.ts  +2 −1', detail: { kind: 'diff', body: '-a\n+b' } });
    expect(done('write_file', {}, { display: { kind: 'create', path: 'b.ts', added: 5, removed: 0 } }).title).toBe('Created b.ts  +5');
    expect(done('open_repo', {}, { display: { kind: 'repo', repo: 'a/b' } }).title).toBe('Opened a/b');
  });

  it('marks commands by how they ended, with their output to open', () => {
    expect(done('run_command', {}, { display: { kind: 'command', command: 'npm test', exitCode: 0, output: 'ok' } })).toMatchObject({ status: 'done', title: 'Ran npm test (OK)', detail: { kind: 'output', body: 'ok' } });
    expect(done('run_command', {}, { display: { kind: 'command', command: 'npm test', exitCode: 1, output: 'FAIL' } })).toMatchObject({ status: 'failed', title: 'Ran npm test (exit 1)' });
    expect(done('run_command', {}, { display: { kind: 'command', command: 'sleep 99', exitCode: null, timedOut: true } }).title).toBe('Ran sleep 99 (timed out)');
    expect(done('run_command', {}, { display: { kind: 'command', command: 'x', exitCode: 0, output: '' } }).detail).toBeUndefined();
  });

  it('says plainly when something was declined or failed', () => {
    expect(done('run_command', {}, { ok: false, display: { kind: 'command', command: 'rm -rf build', denied: true } })).toMatchObject({ status: 'declined', title: 'You declined: rm -rf build' });
    expect(done('edit_file', {}, { ok: false, display: { kind: 'edit', path: 'a.ts', denied: true } }).title).toBe('You declined the change to a.ts');
    expect(done('read_file', { path: '.env' }, { ok: false, text: '.env looks like a secrets file, so Quo doesn’t read it.' })).toMatchObject({ status: 'failed', title: 'Reading .env didn’t work: .env looks like a secrets file, so Quo doesn’t read it.' });
  });
});

describe('a model that is going round in circles', () => {
  const read = (id: string, path = 'a.ts') => reply({ toolCalls: [call(id, 'read_file', { path })] });

  it('is not let run the same call a third time, and is told so', async () => {
    const { deps, ran, asked } = script([read('c1'), read('c2'), read('c3'), read('c4'), reply({ content: 'Giving up.' })]);
    await runAgent(user, deps);
    expect(ran.filter(r => r.name === 'read_file')).toHaveLength(2);
    const told = asked.at(-1)!.filter(m => m.role === 'tool').map(m => m.content);
    expect(told.slice(2).every(text => /already made this exact call twice/.test(text))).toBe(true);
  });

  it('can repeat a call after doing something else in between', async () => {
    const { deps, ran } = script([read('c1'), read('c2', 'b.ts'), read('c3'), read('c4', 'b.ts'), read('c5'), reply({ content: 'Done.' })]);
    await runAgent(user, deps);
    expect(ran).toHaveLength(5);
  });

  it('stops after a run of failures, and says so', async () => {
    const failing: ToolResult = { ok: false, text: 'No such file', display: { kind: 'error' } };
    const { deps, ran } = script(Array.from({ length: 12 }, (_, i) => read(`c${i}`, `f${i}.ts`)), { read_file: failing });
    const outcome = await runAgent(user, deps);
    expect(ran).toHaveLength(5);
    expect(outcome.limited).toBe(true);
    expect(outcome.text).toMatch(/kept running into errors/);
  });

  it('doesn’t count what the person declined, or failures with a success between', async () => {
    const declined: ToolResult = { ok: false, text: 'denied', display: { kind: 'edit', denied: true } };
    const { deps, ran } = script(Array.from({ length: 7 }, (_, i) => reply({ toolCalls: [call(`c${i}`, 'edit_file', { path: `f${i}` })] })).concat(reply({ content: 'Fine.' })), { edit_file: declined });
    const outcome = await runAgent(user, deps);
    expect(ran).toHaveLength(7);
    expect(outcome.limited).toBe(false);
    let n = 0;
    const flaky = script([...Array.from({ length: 10 }, (_, i) => read(`d${i}`, `g${i}.ts`)), reply({ content: 'Done.' })], { read_file: () => (++n % 3 === 0 ? { ok: true, text: 'fine' } : { ok: false, text: 'nope', display: { kind: 'error' } }) });
    expect((await runAgent(user, flaky.deps)).limited).toBe(false);
  });
});

describe('telling how full the memory is', () => {
  it('estimates before each question, and uses the provider’s own count after a reply', async () => {
    const seen: [number, boolean][] = [];
    const { deps } = script([
      reply({ toolCalls: [call('c1', 'list_directory', {})], usage: { input: 1200, output: 30 } }),
      reply({ content: 'Done.' }),
    ]);
    await runAgent(user, { ...deps, onContext: (tokens, exact) => seen.push([tokens, exact]) });
    expect(seen[0][1]).toBe(false);
    expect(seen[0][0]).toBeGreaterThan(0);
    expect(seen[1]).toEqual([1230, true]);
    expect(seen[2][1]).toBe(false);
    expect(seen[2][0]).toBeGreaterThan(seen[0][0]);
  });

  it('counts messages and tool calls', () => {
    expect(estimateTokens([{ role: 'user', content: 'x'.repeat(350) }])).toBe(106);
    expect(estimateTokens([{ role: 'assistant', content: '', tool_calls: [{ id: '1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a"}' } }] }])).toBeGreaterThan(6);
  });
});

describe('reading tools in one reply', () => {
  it('start together, are answered in the order asked, and a change waits for them', async () => {
    const log: string[] = [];
    const releases: (() => void)[] = [];
    const { deps, asked } = script([
      reply({ toolCalls: [call('a', 'read_file', { path: 'a.js' }), call('b', 'search_text', { pattern: 'x' }), call('c', 'edit_file', { path: 'a.js', old_string: 'x', new_string: 'y' }), call('d', 'read_file', { path: 'b.js' })], finish: 'tool_calls' }),
      reply({ content: 'Done.' }),
    ]);
    deps.runTool = async (name, args) => {
      log.push(`start ${name} ${String(args.path ?? args.pattern)}`);
      if (name === 'read_file' || name === 'search_text') await new Promise<void>(resolve => releases.push(resolve));
      log.push(`end ${name}`);
      return { ok: true, text: `${name} ok`, display: { kind: 'list', entries: 1 } };
    };
    const running = runAgent(user, deps);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(log).toEqual(['start read_file a.js', 'start search_text x']); // both reads in flight, the edit not yet
    releases.forEach(release => release());
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(log.slice(2)).toEqual(['end read_file', 'end search_text', 'start edit_file a.js', 'end edit_file', 'start read_file b.js']);
    releases.forEach(release => release());
    await running;
    const second = asked[1].filter(m => m.role === 'tool');
    expect(second.map(m => m.tool_call_id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('give every call an answer when the person stops in the middle', async () => {
    const { deps, controller } = script([reply({ toolCalls: [call('a', 'read_file', { path: 'a.js' }), call('b', 'read_file', { path: 'b.js' })], finish: 'tool_calls' })]);
    deps.runTool = async () => {
      controller.abort();
      return { ok: true, text: 'late', display: { kind: 'list', entries: 1 } };
    };
    const outcome = await runAgent(user, deps);
    expect(outcome.stopped).toBe(true);
    expect(outcome.steps.map(step => step.status)).toEqual(['stopped', 'stopped']);
  });
});
