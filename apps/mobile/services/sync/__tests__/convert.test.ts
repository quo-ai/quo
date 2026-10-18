import type { Conversation, Message } from '@/types/chat';
import { parseChainOfThought } from '@/components/message/parseChainOfThought';
import {
  chatFingerprint, fromWireChat, fromWireMemory, fromWireMessage, splitThinking, toWireChat, toWireMemory, toWireMessage,
} from '../convert';

const stats = { promptTokens: 40, completionTokens: 25, totalTokens: 65, promptTime: 0.4, generationTime: 2.5, totalTime: 2.9, tokensPerSecond: 10, contextSize: 4096, contextUsed: 2 };
const user = (id: string, content: string, extra: Partial<Message> = {}): Message => ({ id, role: 'user', content, timestamp: 100, ...extra });
const assistant = (id: string, content: string, extra: Partial<Message> = {}): Message => ({ id, role: 'assistant', content, timestamp: 200, ...extra });
const chat = (messages: Message[], extra: Partial<Conversation> = {}): Conversation => ({ id: '1760-abc', title: 'Chat', messages, createdAt: 1, updatedAt: 2, ...extra });

describe('splitThinking', () => {
  const samples = [
    'plain answer',
    '<think>Hmm, let me think.</think>\n\nThe answer is 4.',
    '<think>no closing tag yet, still thinking',
    'already thinking when this began</think>The answer.',
    '[THINK]mistral style[/THINK]Answer here',
    '[THINK]still going',
    'started thinking[/THINK] done',
    '<think>a\n\n\n\nb <tag>stuff</tag></think>after',
    '',
  ];

  it.each(samples)('gives the same result as the message bubble’s parser: %j', sample => {
    const mine = splitThinking(sample);
    const theirs = parseChainOfThought(sample);
    expect(mine).toEqual({ thinking: theirs.thinking, content: theirs.content });
  });
});

describe('a phone message on the wire', () => {
  it('turns inline thinking into a reasoning field, and keeps the phone-only details', () => {
    const wire = toWireMessage(assistant('a1', '<think>Because.</think>\n\nIt is 4.', { stats, toolActions: [{ type: 'memory_save', name: 'save', result: 'ok' }] }));
    expect(wire).toMatchObject({ id: 'a1', role: 'assistant', content: 'It is 4.', reasoning: 'Because.', timestamp: 200 });
    expect(wire.stats).toEqual({ tokens: 25, tokensPerSecond: 10, timeToFirstTokenMs: 400 });
    expect(wire.x).toEqual({ mobile: { stats, toolActions: [{ type: 'memory_save', name: 'save', result: 'ok' }] } });
  });

  it('leaves photos and documents behind, keeping their names', () => {
    const wire = toWireMessage(user('u1', 'what is this?', {
      image: { uri: 'file:///photos/cat.jpg', width: 800, height: 600, base64: 'AAAA' },
      document: { uri: 'file:///docs/a.pdf', name: 'a.pdf', mimeType: 'application/pdf', size: 10, extractedText: 'secret' },
    }));
    expect(JSON.stringify(wire)).not.toMatch(/file:\/\/|AAAA|secret/);
    expect(wire.attachments).toEqual([
      { id: 'u1:image', kind: 'image', name: 'Photo', width: 800, height: 600, omitted: true },
      { id: 'u1:document', kind: 'document', name: 'a.pdf', omitted: true },
    ]);
  });

  it('writes nothing for fields it doesn’t have', () => {
    expect(Object.keys(toWireMessage(user('u2', 'hi'))).sort()).toEqual(['content', 'id', 'role', 'timestamp']);
  });

  it('comes back as the same message when nothing changed, with everything local kept', () => {
    const local = assistant('a1', '<think>Because.</think>It is 4.', { stats });
    expect(fromWireMessage(toWireMessage(local), local, 1)).toBe(local);
  });

  it('takes the new text of a changed message but keeps this phone’s photo and details', () => {
    const local = user('u1', 'old question', { image: { uri: 'file:///cat.jpg', width: 1, height: 1 } });
    const merged = fromWireMessage({ ...toWireMessage(local), content: 'edited question' }, local, 1);
    expect(merged.content).toBe('edited question');
    expect(merged.image).toEqual(local.image);
  });

  it('builds a phone message from one that came from the web, thinking and all', () => {
    const message = fromWireMessage({ id: 'w1', role: 'assistant', content: 'Hello', reasoning: 'Greeting.', modelName: 'Qwen' }, undefined, 777);
    expect(message).toMatchObject({ id: 'w1', role: 'assistant', content: '<think>Greeting.</think>\n\nHello', timestamp: 777 });
    expect(parseChainOfThought(message.content)).toEqual({ thinking: 'Greeting.', content: 'Hello' });
    expect(message.stats).toBeUndefined();
    expect('isStreaming' in message).toBe(false);
  });

  it('keeps fields other apps added, and only those, apart from its own', () => {
    const wire = { id: 'w2', role: 'user' as const, content: 'hi', x: { web: { starred: true }, mobile: { toolActions: [] } } };
    const message = fromWireMessage(wire, undefined, 1);
    expect(message.x).toEqual({ web: { starred: true } });
    expect(toWireMessage(message).x).toMatchObject({ web: { starred: true } });
  });
});

describe('a phone chat on the wire', () => {
  it('round-trips without losing anything the phone had', () => {
    const local = chat([
      user('u1', 'hello', { image: { uri: 'file:///a.jpg', width: 2, height: 2 } }),
      assistant('a1', '<think>x</think>\n\nhi there', { stats, toolActions: [{ type: 'info_query', name: 'time', result: 'noon' }] }),
    ], { x: { web: { pinned: true } } });
    const back = fromWireChat(toWireChat(local), local);
    expect(back.messages[0]).toBe(local.messages[0]);
    expect(back.messages[1]).toBe(local.messages[1]);
    expect(back).toMatchObject({ id: local.id, title: 'Chat', createdAt: 1, updatedAt: 2, x: { web: { pinned: true } } });
  });

  it('merges a longer chat from elsewhere, keeping this phone’s own messages as they were', () => {
    const local = chat([user('u1', 'hello', { image: { uri: 'file:///a.jpg', width: 2, height: 2 } }), assistant('a1', 'hi')]);
    const remote = { ...toWireChat(local), updatedAt: 9, messages: [...toWireChat(local).messages, { id: 'u2', role: 'user' as const, content: 'more', timestamp: 300 }] };
    const merged = fromWireChat(remote, local);
    expect(merged.messages.map(m => m.id)).toEqual(['u1', 'a1', 'u2']);
    expect(merged.messages[0].image).toEqual({ uri: 'file:///a.jpg', width: 2, height: 2 });
    expect(merged.updatedAt).toBe(9);
  });

  it('keeps the long-chat summary only while the messages it covers are unchanged', () => {
    const summary = { text: 'They talked about trips.', coversMessageCount: 2, updatedAt: 5 };
    const local = chat([user('u1', 'a'), assistant('a1', 'b'), user('u2', 'c')], { contextSummary: summary });
    expect(fromWireChat(toWireChat(local), local).contextSummary).toEqual(summary);
    const longer = { ...toWireChat(local), messages: [...toWireChat(local).messages, { id: 'a2', role: 'assistant' as const, content: 'd' }] };
    expect(fromWireChat(longer, local).contextSummary).toEqual(summary);
    const different = { ...toWireChat(local), messages: [{ id: 'other', role: 'user' as const, content: 'x' }, ...toWireChat(local).messages.slice(1)] };
    expect(fromWireChat(different, local).contextSummary).toBeUndefined();
    expect(fromWireChat(toWireChat(local)).contextSummary).toBeUndefined(); // never sent
  });

  it('never puts the summary on the wire', () => {
    const wire = toWireChat(chat([user('u1', 'a')], { contextSummary: { text: 'secret digest', coversMessageCount: 1, updatedAt: 1 } }));
    expect(JSON.stringify(wire)).not.toContain('secret digest');
  });

  it('has a fingerprint that moves when a message is added or the chat is edited', () => {
    const a = chat([user('u1', 'a')]);
    expect(chatFingerprint(a)).toBe(chatFingerprint({ ...a }));
    expect(chatFingerprint(a)).not.toBe(chatFingerprint({ ...a, messages: [...a.messages, assistant('a1', 'b')] }));
    expect(chatFingerprint(a)).not.toBe(chatFingerprint({ ...a, updatedAt: 3 }));
  });
});

describe('memories', () => {
  it('use their creation time as the edit time until they are edited', () => {
    expect(toWireMemory({ id: 'mem_1', content: 'Likes tea', createdAt: 5 })).toEqual({ id: 'mem_1', content: 'Likes tea', createdAt: 5, updatedAt: 5 });
    expect(toWireMemory({ id: 'mem_1', content: 'Likes tea', createdAt: 5, updatedAt: 9 }).updatedAt).toBe(9);
  });

  it('come back as the phone keeps them', () => {
    expect(fromWireMemory({ id: 'mem_1', content: 'Likes tea', createdAt: 5, updatedAt: 9 })).toEqual({ id: 'mem_1', content: 'Likes tea', createdAt: 5, updatedAt: 9 });
  });
});
