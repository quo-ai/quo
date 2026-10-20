// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ALL_TOOLS, AGENT_MODEL, call, ctx, events, loadServer, signIn, step, stubUpstream } from './agentHelpers.js';

vi.stubEnv('OPENROUTER_API_KEY', '');
vi.stubEnv('PADDLE_API_KEY', '');
vi.stubEnv('RESEND_API_KEY', '');

beforeAll(loadServer);
afterEach(() => {
  ctx.config.openRouterKey = null;
  vi.unstubAllGlobals();
});
const config = new Proxy({} as typeof ctx.config, { get: (_, key) => (ctx.config as Record<string | symbol, unknown>)[key], set: (_, key, value) => ((ctx.config as Record<string | symbol, unknown>)[key] = value, true) });
const handleApi = (...args: Parameters<typeof ctx.handleApi>) => ctx.handleApi(...args);

describe('Code mode on the free model', () => {
  const LUNA = 'openai/gpt-6-luna';
  const light = (token: string | null, extra: Record<string, unknown> = {}) => step(token, { model: LUNA, agent: { tools: [...ALL_TOOLS, 'task'], project: 'demo', platform: 'linux' }, ...extra });
  const chunk = [{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }];

  it('works in a small form: no helpers, a capped reply, paid for by its own daily steps, not the free messages', async () => {
    const token = await signIn('free-code@example.com');
    const requests = stubUpstream(chunk);
    const response = await light(token);
    expect(response.status).toBe(200);
    expect(response.headers.get('x-quo-billing')).toBe('free');
    const done = (await events(response)).find(e => e.event === 'done')!;
    expect(done.data.freeRemaining).toBeNull();
    const names = (requests[0].body.tools as { function: { name: string } }[]).map(t => t.function.name);
    expect(names).toContain('read_file');
    expect(names).not.toContain('task');
    expect(requests[0].body.max_tokens as number).toBeLessThanOrEqual(4096);
  });

  it('does not use up the free chat messages', async () => {
    const token = await signIn('free-code2@example.com');
    stubUpstream(chunk);
    await (await light(token)).text();
    stubUpstream(chunk);
    const chat = await call(token, 'POST', 'chat', { model: LUNA, messages: [{ role: 'user', content: 'hi' }] });
    const done = (await events(chat)).find(e => e.event === 'done')!;
    expect(done.data.freeRemaining).toBe(config.freeDailyMessages - 1);
  });

  it('turns away helpers and summaries, which cost more', async () => {
    const token = await signIn('free-code3@example.com');
    stubUpstream(chunk);
    for (const role of ['explore', 'summarize']) {
      const response = await light(token, { agent: { tools: ALL_TOOLS, project: 'demo', role } });
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe('agent_unsupported');
    }
  });

  it('stops a reply after its steps, and a conversation that has grown too large', async () => {
    const token = await signIn('free-code4@example.com');
    stubUpstream(chunk);
    const call_ = (i: number) => ({ id: `c${i}`, type: 'function', function: { name: 'read_file', arguments: '{"path":"a.js"}' } });
    const turn = (steps: number) => [
      { role: 'user', content: 'Look' },
      ...Array.from({ length: steps }, (_, i) => [{ role: 'assistant', content: '', tool_calls: [call_(i)] }, { role: 'tool', tool_call_id: `c${i}`, content: 'x' }]).flat(),
    ];
    expect((await light(token, { messages: turn(7) })).status).toBe(200);
    const over = await light(token, { messages: turn(8) });
    expect(over.status).toBe(429);
    expect((await over.json()).error).toBe('free_code_turn_limit');
    const big = await light(token, { messages: [{ role: 'user', content: 'x'.repeat(120_000) }] });
    expect(big.status).toBe(413);
  });

  it('runs out of its daily steps with a clear message for someone not signed in, and leaves other models alone', async () => {
    const before = config.freeDailyCodeStepsPerIp;
    config.freeDailyCodeStepsPerIp = 2;
    // Its own address, so what the other tests used today does not count.
    const fromElsewhere = () => handleApi(new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-quo-device': randomUUID(), 'x-forwarded-for': '10.44.44.44' },
      body: JSON.stringify({ model: LUNA, messages: [{ role: 'user', content: 'Look' }], agent: { tools: ALL_TOOLS, project: 'demo', platform: 'linux' } }),
    }), 'chat');
    try {
      stubUpstream(chunk);
      expect((await fromElsewhere()).status).toBe(200);
      stubUpstream(chunk);
      expect((await fromElsewhere()).status).toBe(200);
      const out = await fromElsewhere();
      expect(out.status).toBe(429);
      const body = await out.json();
      expect(body.error).toBe('free_code_limit');
      expect(body.message).toMatch(/free coding steps/);
    } finally {
      config.freeDailyCodeStepsPerIp = before;
    }
  });

  it('is listed as available only for the free model', async () => {
    const list = await (await call(null, 'GET', 'models')).json();
    const luna = list.models.find((m: { id: string }) => m.id === LUNA);
    expect(luna).toMatchObject({ free: true, agent: false, agentLight: true });
    expect(list.models.filter((m: { agentLight: boolean }) => m.agentLight)).toHaveLength(1);
  });
});

describe('a chat with no folder yet', () => {
  const chunk = [{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }];
  const folderless = (token: string | null, model = AGENT_MODEL, extra: Record<string, unknown> = {}) =>
    step(token, { model, agent: { tools: ['open_project', 'read_file', 'edit_file'].slice(0, 1), project: '', platform: 'linux', environment: { app: { name: 'Quo Desktop', version: '1.3.0' } } }, ...extra });

  it('gets one tool, a prompt that lets it decide, and no pretend project', async () => {
    const token = await signIn('folderless@example.com');
    const requests = stubUpstream(chunk);
    expect((await folderless(token)).status).toBe(200);
    expect((requests[0].body.tools as { function: { name: string } }[]).map(t => t.function.name)).toEqual(['open_project']);
    const system = (requests[0].body.messages as { content: string }[])[0].content;
    expect(system).toMatch(/Most messages need no tool\. Answer them directly/);
    expect(system).toContain('You are Claude Haiku 5.5');
    expect(system).not.toMatch(/Project folder:|instead of saying you cannot|inside Quo Desktop/);
  });

  it('never adds the project tools, whatever else is asked for alongside it', async () => {
    const token = await signIn('folderless2@example.com');
    const requests = stubUpstream(chunk);
    await (await step(token, { agent: { tools: ['open_project', 'edit_file', 'run_command'], project: 'x' } })).text();
    expect((requests[0].body.tools as { function: { name: string } }[]).map(t => t.function.name)).toEqual(['open_project']);
  });

  it('is an ordinary free message for the free model, not a coding step', async () => {
    const token = await signIn('folderless3@example.com');
    stubUpstream(chunk);
    const response = await folderless(token, 'openai/gpt-6-luna');
    expect(response.status).toBe(200);
    const done = (await events(response)).find(e => e.event === 'done')!;
    expect(done.data.freeRemaining).toBe(config.freeDailyMessages - 1);
  });

  it('still turns away a paid model that cannot use tools', async () => {
    const token = await signIn('folderless4@example.com');
    const catalog = await (await call(null, 'GET', 'models')).json();
    const weak = catalog.models.find((m: { agent: boolean; free: boolean }) => !m.agent && !m.free).id;
    const response = await folderless(token, weak);
    expect(response.status).toBe(400);
  });
});

describe('web search in a chat with no folder yet', () => {
  const LUNA = 'openai/gpt-6-luna';
  const chunk = [{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }];
  const asLuna = (token: string | null, messages: unknown, tools: string[]) => step(token, { model: LUNA, messages, agent: { tools, project: '', platform: 'linux' } });
  const toolTurn = [
    { role: 'user', content: 'What is the latest version of Node?' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'web_search', arguments: '{"query":"node latest version"}' } }] },
    { role: 'tool', tool_call_id: 'c1', content: 'Node 26.1' },
  ];

  it('gives the model the search tools next to open_project, and tells it it can browse', async () => {
    const token = await signIn('folderless-web@example.com');
    const requests = stubUpstream(chunk);
    expect((await step(token, { agent: { tools: ['open_project', 'web_search', 'fetch_url', 'edit_file'], project: '', platform: 'linux', environment: { app: { name: 'Quo Desktop' } } } })).status).toBe(200);
    expect((requests[0].body.tools as { function: { name: string } }[]).map(t => t.function.name).sort()).toEqual(['fetch_url', 'open_project', 'web_search']);
    const system = (requests[0].body.messages as { content: string }[])[0].content;
    expect(system).toMatch(/Use web_search and fetch_url for current or specific facts/);
    expect(system).not.toMatch(/You cannot|you can search the web and read pages/);
  });

  it('counts the first request as a free chat message and the step after a search as a coding step', async () => {
    const token = await signIn('folderless-web2@example.com');
    const tools = ['open_project', 'web_search', 'fetch_url'];
    stubUpstream(chunk);
    const first = await asLuna(token, toolTurn.slice(0, 1), tools);
    expect((await events(first)).find(e => e.event === 'done')!.data.freeRemaining).toBe(config.freeDailyMessages - 1);
    stubUpstream(chunk);
    const second = await asLuna(token, toolTurn, tools);
    expect(second.status).toBe(200);
    const done = (await events(second)).find(e => e.event === 'done')!;
    expect(done.data.freeRemaining).toBeNull(); // not a free chat message: it came from the coding steps
  });

  it('still caps the steps of a reply for the free model after searches', async () => {
    const token = await signIn('folderless-web3@example.com');
    stubUpstream(chunk);
    const search = (i: number) => [{ role: 'assistant', content: '', tool_calls: [{ id: `c${i}`, type: 'function', function: { name: 'web_search', arguments: '{"query":"x"}' } }] }, { role: 'tool', tool_call_id: `c${i}`, content: 'r' }];
    const long = [{ role: 'user', content: 'Look it up' }, ...Array.from({ length: 8 }, (_, i) => search(i)).flat()];
    const response = await asLuna(token, long, ['open_project', 'web_search', 'fetch_url']);
    expect(response.status).toBe(429);
    expect((await response.json()).error).toBe('free_code_turn_limit');
  });
});

describe('thinking, as each model really offers it', () => {
  const chunk = [{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }];
  const chat = (token: string | null, model: string, thinking?: unknown) =>
    call(token, 'POST', 'chat', { model, messages: [{ role: 'user', content: 'hi' }], ...(thinking === undefined ? {} : { thinking }) });
  const reasoningOf = async (model: string, thinking?: unknown) => {
    const token = await signIn(`think-${randomUUID()}@example.com`);
    const requests = stubUpstream(chunk);
    expect((await chat(token, model, thinking)).status).toBe(200);
    return requests[0].body.reasoning;
  };

  it('lists the levels each model has, with no Off for a model that always thinks', async () => {
    const list = await (await call(null, 'GET', 'models')).json();
    const levels = (id: string) => list.models.find((m: { id: string }) => m.id === id).thinking;
    expect(levels('anthropic/claude-sonnet-5.5')).toEqual(['quick', 'auto']); // its default already is high
    expect(levels('google/gemini-4-argon')).toEqual(['quick', 'auto', 'deep']);
    expect(levels('anthropic/claude-haiku-5.5')).toEqual(['off', 'quick', 'auto', 'deep']);
    expect(levels('mistralai/mistral-large-4-0')).toEqual(['off', 'auto']);
    expect(levels('google/gemma-4-31b-it')).toEqual(['off', 'deep']);
    expect(levels('openai/gpt-6-luna')).toEqual(['off', 'auto']); // the free model is held to a low effort
    expect(list.models.every((m: { thinking: unknown[]; supportsThinking: boolean }) => m.supportsThinking === m.thinking.length > 0)).toBe(true);
  });

  it('sends nothing for Auto, so the model decides, and only efforts the model accepts otherwise', async () => {
    expect(await reasoningOf('anthropic/claude-sonnet-5.5', 'auto')).toBeUndefined();
    expect(await reasoningOf('google/gemini-4-argon', 'deep')).toEqual({ effort: 'high' });
    expect(await reasoningOf('deepseek/deepseek-v4-pro-0813', 'quick')).toEqual({ effort: 'low' });
    expect(await reasoningOf('anthropic/claude-haiku-5.5', 'off')).toEqual({ effort: 'none' });
    expect(await reasoningOf('google/gemma-4-31b-it', 'off')).toEqual({ enabled: false });
  });

  it('cannot switch off a model that always thinks, or ask a model for an effort it lacks', async () => {
    expect(await reasoningOf('anthropic/claude-sonnet-5.5', 'off')).toBeUndefined();
    expect(await reasoningOf('mistralai/mistral-large-4-0', 'quick')).toBeUndefined();
  });

  it('holds the free model to low, however much is asked for', async () => {
    expect(await reasoningOf('openai/gpt-6-luna', 'auto')).toEqual({ effort: 'low' });
    expect(await reasoningOf('openai/gpt-6-luna', 'deep')).toEqual({ effort: 'low' });
    expect(await reasoningOf('openai/gpt-6-luna', 'off')).toEqual({ effort: 'none' });
  });

  it('treats an older app’s yes and no the way it always did, and ignores nonsense', async () => {
    expect(await reasoningOf('anthropic/claude-haiku-5.5', false)).toEqual({ effort: 'low' });
    expect(await reasoningOf('anthropic/claude-haiku-5.5', true)).toBeUndefined();
    expect(await reasoningOf('anthropic/claude-haiku-5.5', 'maximum overdrive')).toBeUndefined();
    expect(await reasoningOf('anthropic/claude-haiku-5.5', { effort: 'max' })).toBeUndefined();
  });
});
