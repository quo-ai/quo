import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chatProject, rememberChatProject } from '../../agent/session';
import type { Message } from '../../chat/types';
import { modelMessages, summarize, transcript } from '../../chat/summary';
import { installLocalStorage } from '../../providers/__tests__/helpers';
import type { ModelChoice } from '../../models';
import { contextUsage, contextWindow, conversationTokens, formatTokens, FIXED_TOKENS, ratio } from '../usage';

installLocalStorage();
beforeEach(() => localStorage.clear());

const msg = (role: 'user' | 'assistant', content: string, extra: Partial<Message> = {}): Message => ({ id: Math.random().toString(36), role, content, ...extra });
const local = { kind: 'local', model: { id: 'l', contextSize: 16384 } } as unknown as ModelChoice;
const cloud = { kind: 'cloud', model: { id: 'c' } } as unknown as ModelChoice;
const own = (contextTokens?: number) => ({ kind: 'own', model: { id: 'o', contextTokens }, provider: {} }) as unknown as ModelChoice;

describe('the size of a model’s memory in this chat', () => {
  it('is what Quo loads or sends, and unknown when nobody says', () => {
    expect(contextWindow(local, 'chat')).toBe(16384);
    expect(contextWindow(local, 'code')).toBe(32768);
    expect(contextWindow(cloud, 'chat')).toBe(32768);
    expect(contextWindow(cloud, 'code')).toBeNull();
    expect(contextWindow(own(200_000), 'code')).toBe(200_000);
    expect(contextWindow(own(200_000), 'chat')).toBe(64_000);
    expect(contextWindow(own(8000), 'chat')).toBe(8000);
    expect(contextWindow(own(), 'chat')).toBe(32768);
    expect(contextWindow(own(), 'code')).toBeNull();
    expect(contextWindow(null, 'chat')).toBeNull();
  });
});

describe('how full it is', () => {
  const chat = [msg('user', 'x'.repeat(3500)), msg('assistant', 'y'.repeat(3500))];

  it('adds the rules to the conversation, and says nothing for an empty chat', () => {
    expect(contextUsage(local, 'chat', [], null)).toBeNull();
    const usage = contextUsage(local, 'code', chat, null)!;
    expect(usage.fixed).toBe(FIXED_TOKENS.code);
    expect(usage.used).toBe(FIXED_TOKENS.code + conversationTokens(chat));
    expect(usage.limit).toBe(32768);
    expect(usage.exact).toBe(false);
    expect(ratio(usage)).toBeCloseTo(usage.used / 32768);
  });

  it('prefers what the model is working with now: the provider’s count as it is, an estimate with the rules added', () => {
    expect(contextUsage(local, 'code', chat, { tokens: 9000, exact: true })).toMatchObject({ used: 9000, exact: true });
    expect(contextUsage(local, 'code', chat, { tokens: 9000, exact: false })).toMatchObject({ used: 9000 + FIXED_TOKENS.code, exact: false });
    expect(contextUsage(local, 'chat', [], { tokens: 100, exact: false })).not.toBeNull();
  });

  it('counts documents that were attached, and has no percentage without a window', () => {
    const attached = msg('user', 'what is this?', { attachments: [{ id: '1', kind: 'document', name: 'a.txt', text: 'z'.repeat(7000) }, { id: '2', kind: 'image', name: 'p.png', dataUrl: 'data:' }] });
    expect(conversationTokens([attached])).toBeGreaterThan(2800);
    expect(ratio(contextUsage(cloud, 'code', chat, null)!)).toBeNull();
  });

  it('writes counts short', () => {
    expect([950, 1500, 12_400, 1_250_000].map(formatTokens)).toEqual(['950', '1.5k', '12k', '1.3M']);
  });
});

describe('a conversation that was summarised', () => {
  const notes = msg('assistant', 'The user is fixing the login bug in auth.js. Done: read auth.js. Left: the test.', { summary: true });

  it('sends the notes in front of the first message after them, and nothing from before', () => {
    const all = [msg('user', 'old one'), msg('assistant', 'old reply'), notes, msg('user', 'next question'), msg('assistant', 'answer'), msg('user', 'and then?')];
    const sent = modelMessages(all);
    expect(sent.map(m => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(sent[0].content).toMatch(/^Notes on our conversation so far/);
    expect(sent[0].content).toMatch(/fixing the login bug/);
    expect(sent[0].content).toMatch(/next question$/);
    expect(JSON.stringify(sent)).not.toContain('old reply');
    expect(all).toHaveLength(6);
  });

  it('uses only the latest notes, leaves other conversations alone, and copes with notes at the end', () => {
    const plain = [msg('user', 'a'), msg('assistant', 'b')];
    expect(modelMessages(plain)).toBe(plain);
    const second = msg('assistant', 'newer notes', { summary: true });
    expect(modelMessages([msg('user', 'q'), notes, msg('user', 'r'), second, msg('user', 's')])[0].content).toMatch(/newer notes/);
    expect(modelMessages([msg('user', 'q'), notes])).toEqual([]);
  });

  it('is written from the messages and what was done, newest kept when it is long', () => {
    const steps = [{ id: '1', tool: 'read_file', status: 'done' as const, title: 'Read auth.js, lines 1–80 of 200' }];
    const text = transcript([msg('user', 'fix login'), msg('assistant', 'Looking.', { steps }), msg('assistant', '')]);
    expect(text).toBe('User: fix login\n\nAssistant: Looking.\n(Read auth.js, lines 1–80 of 200)');
    const long = transcript(Array.from({ length: 40 }, (_, i) => msg('user', `${i}`.padEnd(2900, '.'))));
    expect(long.length).toBeLessThan(31_000);
    expect(long).toMatch(/^\[The start is left out\.\]/);
    expect(long).toMatch(/39\.\.\./);
  });
});

describe('asking the model for notes', () => {
  it('uses the model the chat is on, with the instructions and the transcript, and refuses an empty answer', async () => {
    const calls: unknown[] = [];
    vi.resetModules();
    vi.doMock('../../providers/generate', () => ({ generateOwn: async (_p: unknown, _m: unknown, turns: unknown) => { calls.push(turns); return { content: calls.length === 1 ? '  Notes: the user wants a login fix; auth.js was read.  ' : 'ok', reasoning: '', stopped: false, usage: null }; } }));
    const { summarize: run } = await import('../../chat/summary');
    const choice = { kind: 'own', model: { id: 'o' }, provider: {} } as unknown as ModelChoice;
    const text = await run(choice, [msg('user', 'fix login'), msg('assistant', 'On it.')]);
    vi.doUnmock('../../providers/generate');
    expect(text).toBe('Notes: the user wants a login fix; auth.js was read.');
    const turns = calls[0] as { role: string; content: string }[];
    expect(turns[0]).toMatchObject({ role: 'system' });
    expect(turns[0].content).toMatch(/under 300 words/);
    expect(turns[1].content).toBe('User: fix login\n\nAssistant: On it.');
    await expect(run(choice, [msg('user', 'x')])).rejects.toThrow(/didn’t write any notes/);
    expect(summarize).toBeTypeOf('function');
  });
});

describe('the folder a chat used', () => {
  it('is remembered for that chat, and forgets the oldest chats', () => {
    expect(chatProject('chat-1')).toBeNull();
    expect(chatProject(undefined)).toBeNull();
    rememberChatProject('chat-1', 'proj-a');
    rememberChatProject('chat-2', 'proj-b');
    rememberChatProject('chat-1', 'proj-c');
    expect([chatProject('chat-1'), chatProject('chat-2')]).toEqual(['proj-c', 'proj-b']);
    for (let i = 0; i < 80; i++) rememberChatProject(`filler-${i}`, 'p');
    expect(chatProject('chat-2')).toBeNull();
    expect(chatProject('filler-79')).toBe('p');
  });
});
