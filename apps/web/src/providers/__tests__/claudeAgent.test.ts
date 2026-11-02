import { describe, expect, it, vi } from 'vitest';

const toasts = vi.hoisted(() => [] as string[]);
vi.mock('../../ui/Toasts', () => ({ toast: (text: string) => toasts.push(text) }));

import type { ClaudeEvent, DesktopClaude } from '../../native';
import { chatWithClaudeAgent, claudeThinking, listClaudeModels, CLAUDE_AGENT } from '../claudeAgent';
import { ProviderError } from '../errors';

/** A stand-in for the desktop app's Claude Agent bridge: requests are answered by `answer` through events. */
function fakeBridge(answer: (id: string, emit: (event: ClaudeEvent) => void) => void, status: Awaited<ReturnType<DesktopClaude['status']>> = { ok: { installed: true } }) {
  let listener: ((event: ClaudeEvent) => void) | null = null;
  const sent: unknown[] = [];
  const bridge: DesktopClaude = {
    status: vi.fn(async () => status),
    models: vi.fn(async () => ({ ok: null })),
    request: vi.fn(async request => {
      sent.push(request);
      queueMicrotask(() => answer(request.id, event => listener?.(event)));
      return { ok: null };
    }),
    abort: vi.fn(async () => ({ ok: null })),
    onEvent: callback => {
      listener = callback;
      return () => {};
    },
  };
  return { bridge, sent };
}

const OPUS_55 = { efforts: ['low', 'medium', 'high', 'xhigh', 'max'], default: 'medium', off: false };
const reply = { content: 'Hello.', reasoning: '', toolCalls: [], finish: 'stop', usage: { input: 5, output: 2 } };

describe('Claude Agent', () => {
  it('sends only the model, conversation and tools, and streams the reply back', async () => {
    const { bridge, sent } = fakeBridge((id, emit) => {
      emit({ id, type: 'update', content: 'Hel', reasoning: '' });
      emit({ id, type: 'done', reply });
    });
    const updates: string[] = [];
    const result = await chatWithClaudeAgent({ model: 'sonnet', maxTokens: 4096, messages: [{ role: 'user', content: 'hi' }], webSearch: true, extra: { temperature: 2 } }, partial => updates.push(partial.content), bridge);
    expect(result).toEqual(reply);
    expect(updates).toEqual(['Hel']);
    expect(Object.keys(sent[0] as object).sort()).toEqual(['id', 'messages', 'model', 'tools']);
  });

  it('tells the model Claude Code’s working folder is not the project, after Quo’s own prompt', async () => {
    const { bridge, sent } = fakeBridge((id, emit) => emit({ id, type: 'done', reply }));
    await chatWithClaudeAgent({ model: 'opus', maxTokens: 1, messages: [{ role: 'system', content: 'You are Quo.' }, { role: 'user', content: 'hi' }] }, undefined, bridge);
    await chatWithClaudeAgent({ model: 'opus', maxTokens: 1, messages: [{ role: 'user', content: 'hi' }] }, undefined, bridge);
    const [withPrompt, without] = sent as { messages: { role: string; content: string }[] }[];
    expect(withPrompt.messages[0].content).toMatch(/^You are Quo\.\n\nClaude Code adds notes/);
    expect(withPrompt.messages[0].content).toContain('It is not the user’s project.');
    expect(without.messages[0]).toMatchObject({ role: 'system' });
    expect(without.messages).toHaveLength(2);
  });

  it('passes the Thinking choice and the side-call mark, and nothing it doesn’t know', async () => {
    const { bridge, sent } = fakeBridge((id, emit) => emit({ id, type: 'done', reply }));
    await chatWithClaudeAgent({ model: 'opus', maxTokens: 1, messages: [{ role: 'user', content: 'hi' }], effort: 'deep', oneOff: true }, undefined, bridge);
    await chatWithClaudeAgent({ model: 'opus', maxTokens: 1, messages: [{ role: 'user', content: 'hi' }], effort: 'off' }, undefined, bridge);
    await chatWithClaudeAgent({ model: 'opus', maxTokens: 1, messages: [{ role: 'user', content: 'hi' }], effort: 'ultra' as never }, undefined, bridge);
    expect(sent[0]).toMatchObject({ effort: 'deep', oneOff: true });
    expect(sent[1]).toMatchObject({ effort: 'off' });
    expect(sent[2]).not.toHaveProperty('effort');
  });

  it('says a plan limit notice once', async () => {
    const notice = 'You’ve used 80% of your Claude plan’s 5-hour limit.';
    const { bridge } = fakeBridge((id, emit) => emit({ id, type: 'done', reply: { ...reply, notice } }));
    const ask = () => chatWithClaudeAgent({ model: 'opus', maxTokens: 1, messages: [{ role: 'user', content: 'hi' }] }, undefined, bridge);
    await ask();
    await ask();
    expect(toasts.filter(text => text === notice)).toHaveLength(1);
  });

  it('turns Claude Code’s problems into provider errors the chat can show', async () => {
    const { bridge } = fakeBridge((id, emit) => emit({ id, type: 'error', code: 'claude_auth', message: 'Claude Code isn’t signed in.' }));
    const failure = await chatWithClaudeAgent({ model: 'sonnet', maxTokens: 1, messages: [{ role: 'user', content: 'hi' }] }, undefined, bridge).catch(error => error);
    expect(failure).toBeInstanceOf(ProviderError);
    expect(failure).toMatchObject({ status: 401, code: 'claude_auth', provider: CLAUDE_AGENT.id });
  });

  it('stopping asks the desktop app to stop that request', async () => {
    const { bridge } = fakeBridge(() => {});
    const controller = new AbortController();
    const running = chatWithClaudeAgent({ model: 'sonnet', maxTokens: 1, messages: [{ role: 'user', content: 'hi' }], signal: controller.signal }, undefined, bridge);
    await new Promise(resolve => setTimeout(resolve, 0));
    controller.abort();
    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    expect(bridge.abort).toHaveBeenCalledTimes(1);
  });

  it('outside the desktop app it says where it works', async () => {
    await expect(chatWithClaudeAgent({ model: 'sonnet', maxTokens: 1, messages: [] }, undefined, null)).rejects.toMatchObject({ code: 'claude_missing' });
  });

  it('lists Claude Code’s models only once it is signed in', async () => {
    const signedOut = fakeBridge(() => {}, { ok: { installed: true, signedIn: false, models: [] } }).bridge;
    await expect(listClaudeModels(signedOut)).rejects.toMatchObject({ code: 'claude_auth' });
    const ready = fakeBridge(() => {}, { ok: { installed: true, signedIn: true, models: [{ id: 'opus', name: 'Opus', description: 'Opus 5.5', thinking: OPUS_55, contextTokens: 1_000_000 }, { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', description: '', pinned: true, thinking: { efforts: [], default: null, off: false } }] } }).bridge;
    const [opus, haiku] = await listClaudeModels(ready);
    expect(opus).toMatchObject({ id: 'opus', name: 'Opus', tools: true, group: 'Always the newest', description: 'Opus 5.5', contextTokens: 1_000_000, thinking: ['low', 'medium', 'high', 'xhigh', 'max'], thinkingDefault: 'medium' });
    expect(haiku).toMatchObject({ id: 'claude-haiku-4-5', group: 'Specific versions', thinking: [] });
  });

  it('offers each model Claude Code’s own efforts for it, starting on its default, with Off only where it can stop thinking', () => {
    // Opus 5.5 always thinks, takes every effort and defaults to medium.
    const opus = claudeThinking(OPUS_55);
    expect(opus.levels).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(opus.start).toBe('medium');
    expect(opus.hints.medium).toBe('A balance of speed and depth · Claude Code’s default for this model');
    expect(opus.hints.max).toMatch(/uses up a plan fast/);
    // Opus 4.6 can stop thinking and has no extra high.
    expect(claudeThinking({ efforts: ['low', 'medium', 'high', 'max'], default: 'high', off: true })).toMatchObject({ levels: ['off', 'low', 'medium', 'high', 'max'], start: 'high' });
    // A default Claude Code didn't give: Auto leaves it to Claude Code.
    expect(claudeThinking({ efforts: ['low', 'high'], default: null, off: false })).toMatchObject({ levels: ['auto', 'low', 'high'], start: 'auto' });
    // Nothing to choose.
    expect(claudeThinking({ efforts: [], default: null, off: false }).levels).toEqual([]);
    expect(claudeThinking(undefined).levels).toEqual([]);
  });

});
