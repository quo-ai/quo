import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalModel } from '../../catalog';
import { installLocalStorage, streamOf } from '../../providers/__tests__/helpers';
import { ProviderError } from '../../providers/errors';
import type { Transport } from '../../providers/transport';
import { agentContextChars, agentSampling, AGENT_CONTEXT, askLocalAgentModel } from '../local';
import { agentRating, isLocalCodeAllowed, ratingNote, setLocalCodeAllowed } from '../capability';
import { codeSupport } from '../support';

installLocalStorage();
const load = vi.fn(async () => {});
vi.mock('../../engine/localEngine', () => ({ localEngine: { load: (...args: unknown[]) => load(...(args as [])) } }));

const model = (patch: Partial<LocalModel> = {}): LocalModel => ({
  id: 'qwen35-9b', name: 'Qwen3.5 9B', description: '', files: [], contextSize: 16384, maxTokens: 4096, supportsThinking: true, minMemoryGB: 12,
  sampling: { temperature: 0.7, top_p: 0.8, top_k: 20, min_p: 0, penalty_present: 1.5, penalty_last_n: 256 }, native: true, ...patch,
});
const sse = (...chunks: object[]) => `${chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join('')}data: [DONE]\n\n`;
const reply = (text: string) => sse({ choices: [{ delta: { content: text }, finish_reason: 'stop' }] });
const toolReply = sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'list_directory', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] });
const options = { tools: ['list_directory', 'read_file', 'find_files', 'search_text'], project: 'demo', platform: 'linux', signal: new AbortController().signal, onText: () => {} };

beforeEach(() => {
  localStorage.clear();
  load.mockClear();
  vi.resetModules();
});

describe('an offline model as a coding agent', () => {
  it('asks the engine for tool calls with careful sampling, and the rules written for a small memory', async () => {
    const sent: { path: string; body: Record<string, unknown> }[] = [];
    const transport: Transport = { send: async (_provider, request) => { sent.push({ path: request.path, body: request.body as Record<string, unknown> }); return { status: 200, ok: true, body: streamOf(toolReply) }; } };
    const result = await askLocalAgentModel(model(), [{ role: 'user', content: 'Look around' }], { ...options, instructions: { file: 'AGENTS.md', text: 'Use tabs.' } }, transport);
    expect(result).toEqual({ content: '', toolCalls: [{ id: 'c1', name: 'list_directory', arguments: '{}' }], finish: 'tool_calls', charged: 0, balance: null });
    const body = sent[0].body as { messages: { role: string; content: string }[]; tools: unknown[]; temperature: number; presence_penalty?: unknown; chat_template_kwargs: unknown; stream: boolean; model: string };
    expect(sent[0].path).toBe('/chat/completions');
    expect(body.stream).toBe(true);
    expect(body.tools).toHaveLength(4);
    expect(body.temperature).toBe(0.4);
    expect(body.presence_penalty).toBeUndefined();
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(body.messages[0].content).toMatch(/Your memory is small/);
    expect(body.messages[0].content).toMatch(/Everything stays on this computer/);
    expect(body.messages[0].content).not.toMatch(/sent to the AI provider/);
    expect(body.messages[0].content).toMatch(/<project-notes>\nUse tabs\./);
    expect(body.messages[1]).toEqual({ role: 'user', content: 'Look around' });
  });

  it('keeps a model’s own sampling out of tool calls where it would do harm', () => {
    expect(agentSampling(model({ sampling: { temperature: 0.2, top_p: 1, top_k: 1, min_p: 0, penalty_present: 2 }, supportsThinking: false }))).toEqual({ temperature: 0.2, top_p: 0.9, top_k: 40, min_p: 0.05, max_tokens: 4096 });
  });

  it('starts the engine again, once, if it stopped on its own', async () => {
    let calls = 0;
    const transport: Transport = { send: async () => (++calls === 1 ? { status: 503, ok: false, body: streamOf('{"error":{"message":"loading"}}') } : { status: 200, ok: true, body: streamOf(reply('Back.')) }) };
    expect((await askLocalAgentModel(model(), [{ role: 'user', content: 'x' }], options, transport)).content).toBe('Back.');
    expect(load).toHaveBeenCalledWith(expect.objectContaining({ id: 'qwen35-9b' }), { contextSize: AGENT_CONTEXT });
    const dead: Transport = { send: async () => ({ status: 503, ok: false, body: streamOf('') }) };
    await expect(askLocalAgentModel(model(), [{ role: 'user', content: 'x' }], options, dead)).rejects.toMatchObject({ status: 503 });
  });

  it('says in words when the conversation no longer fits', async () => {
    const full: Transport = { send: async () => ({ status: 400, ok: false, body: streamOf('{"error":{"message":"the request exceeds the available context size (32768 tokens)"}}') }) };
    await expect(askLocalAgentModel(model(), [{ role: 'user', content: 'x' }], options, full)).rejects.toMatchObject({ code: 'context_full', message: expect.stringContaining('no longer fits') });
    await expect(askLocalAgentModel(model(), [{ role: 'user', content: 'x' }], options, { send: async () => { throw new ProviderError(0, 'provider_unreachable', 'x', 'local'); } })).rejects.toBeInstanceOf(ProviderError);
  });

  it('works out how much of a conversation fits the window', () => {
    expect(agentContextChars()).toBe((32768 - 4096 - 3000) * 3);
    expect(agentContextChars(8192)).toBe(20_000);
  });
});

describe('which offline models Code mode is on for', () => {
  const good = model();
  const limited = model({ id: 'qwen35-4b', name: 'Qwen3.5 4B', agent: 'limited' });
  const weak = model({ id: 'qwen35-2b', name: 'Qwen3.5 2B' });
  const own = model({ id: 'custom-abc', name: 'My model', custom: true });

  it('rates models, with a reason for each', () => {
    expect([good, limited, weak, own].map(agentRating)).toEqual(['weak', 'limited', 'weak', 'unknown']);
    expect(agentRating(model({ agent: 'good' }))).toBe('good');
    expect(ratingNote(weak)).toMatch(/Too small/);
    expect(ratingNote(own)).toMatch(/can’t tell/);
  });

  it('turns it on by default only for the recommended ones, and keeps what the person chooses', () => {
    const recommended = model({ id: 'big-model', agent: 'good' });
    expect(isLocalCodeAllowed(recommended)).toBe(true);
    expect([limited, weak, own].map(isLocalCodeAllowed)).toEqual([false, false, false]);
    setLocalCodeAllowed(weak, true);
    setLocalCodeAllowed(recommended, false);
    expect(isLocalCodeAllowed(weak)).toBe(true);
    expect(isLocalCodeAllowed(recommended)).toBe(false);
    setLocalCodeAllowed(weak, false);
    expect(isLocalCodeAllowed(weak)).toBe(false);
  });

  it('keeps those choices across a reload, and ignores damaged storage', async () => {
    setLocalCodeAllowed(weak, true);
    vi.resetModules();
    const fresh = await import('../capability');
    expect(fresh.isLocalCodeAllowed(weak)).toBe(true);
    localStorage.setItem('quo.codeOffline', '{"on":[1,null,"qwen35-4b"],"off":"x"}');
    vi.resetModules();
    const damaged = await import('../capability');
    expect(damaged.isLocalCodeAllowed(limited)).toBe(true);
  });
});

describe('where Code mode is offered', () => {
  const desktop = (native: boolean) => vi.stubGlobal('window', { quoDesktop: { platform: 'linux', version: '1', agent: {}, ...(native ? { engine: {}, models: {} } : {}) } });

  it('needs the desktop app', () => {
    vi.unstubAllGlobals();
    expect(codeSupport({ kind: 'local', model: model() }).available).toBe(false);
    expect(codeSupport(null).available).toBe(false);
  });

  it('is offered with every offline model on the native engine, asking first where it is not recommended', () => {
    desktop(true);
    const recommended = codeSupport({ kind: 'local', model: model({ id: 'support-good', agent: 'good' }) });
    expect(recommended).toMatchObject({ available: true, compact: true, gate: null });
    const weak = codeSupport({ kind: 'local', model: model({ id: 'support-weak', name: 'Qwen3.5 2B' }) });
    expect(weak).toMatchObject({ available: true, compact: true, gate: { name: 'Qwen3.5 2B', allowed: false } });
    weak.gate!.allow();
    expect(codeSupport({ kind: 'local', model: model({ id: 'support-weak', name: 'Qwen3.5 2B' }) }).gate?.allowed).toBe(true);
    vi.unstubAllGlobals();
  });

  it('is not offered with an offline model in a browser, where there is no engine that can call tools', () => {
    desktop(false);
    expect(codeSupport({ kind: 'local', model: model({ agent: 'good' }) }).available).toBe(false);
    vi.unstubAllGlobals();
  });

  it('follows the model’s own flag for cloud models and the user’s own keys, and never asks', () => {
    desktop(true);
    const cloud = { kind: 'cloud', model: { id: 'c', agent: true } } as never;
    expect(codeSupport(cloud)).toEqual({ available: true, compact: false, gate: null });
    expect(codeSupport({ kind: 'own', model: { id: 'o', agent: false }, provider: {} } as never).available).toBe(false);
    vi.unstubAllGlobals();
  });
});
