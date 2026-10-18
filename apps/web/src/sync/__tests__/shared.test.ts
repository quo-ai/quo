// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Conversation } from '../../chat/types';
import { fromWire, toWire } from '../adapters';
import { chatKind, memoryKind, parseChat, parseMemory } from '../kinds';
import { reconcileChat, reconcileMemory } from '../merge';
import type { WireChat, WireMemory } from '../wire';

const message = (id: string, content = id, role: 'user' | 'assistant' = 'user') => ({ id, role, content });
const chat = (updatedAt: number, ...ids: string[]): WireChat => ({ id: 'chat-1', title: 'Chat', createdAt: 1, updatedAt, messages: ids.map(id => message(id)) });
let counter = 0;
const newId = () => `copy-${++counter}`;

describe('reconcileChat', () => {
  it('takes the longer chat when one is the start of the other', () => {
    const shorter = chat(10, 'a', 'b');
    const longer = chat(20, 'a', 'b', 'c');
    expect(reconcileChat(shorter, longer, newId)).toEqual({ item: longer, pushNeeded: false });
    expect(reconcileChat(longer, shorter, newId)).toEqual({ item: longer, pushNeeded: true });
  });

  it('takes the later edit of the same messages', () => {
    const older = { ...chat(10, 'a'), messages: [message('a', 'old')] };
    const newer = { ...chat(20, 'a'), messages: [message('a', 'new')] };
    expect(reconcileChat(older, newer, newId).item.messages[0].content).toBe('new');
    expect(reconcileChat(newer, older, newId)).toMatchObject({ pushNeeded: true });
    expect(reconcileChat(older, older, newId).pushNeeded).toBe(false);
  });

  it('keeps both sides when they truly diverged, the later edit keeping the chat', () => {
    const local = chat(30, 'a', 'x');
    const remote = chat(20, 'a', 'y');
    const kept = reconcileChat(local, remote, newId);
    expect(kept.item).toBe(local);
    expect(kept.pushNeeded).toBe(true);
    expect(kept.copy).toMatchObject({ title: 'Chat (other device)', messages: remote.messages });
    expect(kept.copy!.id).toMatch(/^copy-/);

    const other = reconcileChat(chat(10, 'a', 'x'), chat(20, 'a', 'y'), newId);
    expect(other.item.messages.map(m => m.id)).toEqual(['a', 'y']);
    expect(other.pushNeeded).toBe(false);
    expect(other.copy!.messages.map(m => m.id)).toEqual(['a', 'x']);
  });

  it('never loses a message', () => {
    const local = chat(30, 'a', 'b', 'x');
    const remote = chat(20, 'a', 'b', 'y');
    const { item, copy } = reconcileChat(local, remote, newId);
    const all = new Set([...item.messages, ...copy!.messages].map(m => m.id));
    expect([...all].sort()).toEqual(['a', 'b', 'x', 'y']);
  });
});

describe('reconcileMemory', () => {
  const memory = (updatedAt: number, content: string): WireMemory => ({ id: 'mem', content, createdAt: 1, updatedAt });
  it('takes the later edit; a tie goes to the server’s', () => {
    expect(reconcileMemory(memory(5, 'local'), memory(9, 'remote'))).toMatchObject({ item: { content: 'remote' }, pushNeeded: false });
    expect(reconcileMemory(memory(9, 'local'), memory(5, 'remote'))).toMatchObject({ item: { content: 'local' }, pushNeeded: true });
    expect(reconcileMemory(memory(5, 'local'), memory(5, 'remote'))).toMatchObject({ item: { content: 'remote' }, pushNeeded: false });
  });
});

describe('what counts as a valid record', () => {
  const good = chat(10, 'a');

  it('accepts a chat and rejects anything malformed or under the wrong id', () => {
    expect(parseChat(good, 'chat-1')).toBe(good);
    expect(parseChat(good, 'another-id')).toBeNull();
    for (const bad of [null, 'text', [], {}, { ...good, title: 5 }, { ...good, updatedAt: 'x' }, { ...good, updatedAt: NaN }, { ...good, messages: 'no' },
      { ...good, messages: [{ id: 'a', role: 'system', content: 'x' }] }, { ...good, messages: [{ id: 'a', role: 'user' }] },
      { ...good, messages: [message('a'), message('a')] }]) {
      expect(parseChat(bad, 'chat-1')).toBeNull();
    }
  });

  it('accepts a memory and rejects malformed ones', () => {
    const memory: WireMemory = { id: 'mem_1', content: 'Likes tea', createdAt: 1, updatedAt: 2 };
    expect(parseMemory(memory, 'mem_1')).toBe(memory);
    for (const bad of [null, {}, { ...memory, id: 'other' }, { ...memory, content: '   ' }, { ...memory, content: 3 }, { ...memory, updatedAt: undefined }]) {
      expect(parseMemory(bad, 'mem_1')).toBeNull();
    }
  });

  it('keeps chat ids as they are and prefixes memory ids', () => {
    const none = { get: async () => undefined, put: async () => {}, remove: async () => {}, all: async () => [] };
    const chats = chatKind(none);
    const memories = memoryKind(none);
    expect(chats.recordId('1760-abc')).toBe('1760-abc');
    expect(memories.recordId('mem_1')).toBe('memory:mem_1');
    expect(memories.itemId('memory:mem_1')).toBe('mem_1');
    expect(memories.itemId('1760-abc')).toBeNull();
  });
});

describe('the web app’s chats as wire data', () => {
  const conversation: Conversation = {
    id: 'c1', title: 'With files', createdAt: 1, updatedAt: 2, x: { mobile: { summary: 'kept' } },
    messages: [
      { id: 'm1', role: 'user', content: 'what is this?', timestamp: 5, attachments: [{ id: 'a1', kind: 'image', name: 'cat.jpg', dataUrl: 'data:image/jpeg;base64,AAAA', width: 10, height: 20 }, { id: 'a2', kind: 'document', name: 'notes.txt', text: 'secret text' }] },
      { id: 'm2', role: 'assistant', content: 'a cat', reasoning: 'looking', modelId: 'qwen', modelName: 'Qwen', stats: { tokens: 3, tokensPerSecond: 9, timeToFirstTokenMs: 40 }, x: { mobile: { toolActions: [] } } },
    ],
  };

  it('leaves attachment contents behind, but keeps names, sizes and everything else', () => {
    const wire = toWire(conversation);
    expect(JSON.stringify(wire)).not.toContain('AAAA');
    expect(JSON.stringify(wire)).not.toContain('secret text');
    expect(wire.messages[0].attachments).toEqual([
      { id: 'a1', kind: 'image', name: 'cat.jpg', width: 10, height: 20, omitted: true },
      { id: 'a2', kind: 'document', name: 'notes.txt', omitted: true },
    ]);
    expect(wire.messages[1]).toMatchObject({ reasoning: 'looking', modelName: 'Qwen', stats: { tokens: 3 }, x: { mobile: { toolActions: [] } } });
    expect(wire.x).toEqual({ mobile: { summary: 'kept' } });
    expect(wire.messages[0].timestamp).toBe(5);
  });

  it('puts this device’s own attachment contents back when the chat comes round again', () => {
    const back = fromWire(toWire(conversation), conversation);
    expect(back.messages[0].attachments).toEqual(conversation.messages[0].attachments);
  });

  it('shows another device’s attachments as names only', () => {
    const arrived = fromWire(toWire(conversation));
    expect(arrived.messages[0].attachments!.every(a => a.omitted && !a.dataUrl && !a.text)).toBe(true);
  });

  it('keeps fields from other apps through a round trip', () => {
    const back = fromWire(toWire(conversation), conversation);
    expect(back.x).toEqual(conversation.x);
    expect(back.messages[1].x).toEqual({ mobile: { toolActions: [] } });
  });

  it('does not write missing fields as undefined', () => {
    const wire = toWire({ id: 'c2', title: 't', createdAt: 1, updatedAt: 1, messages: [{ id: 'm', role: 'user', content: 'hi' }] });
    expect(Object.keys(wire.messages[0]).sort()).toEqual(['content', 'id', 'role']);
    expect(Object.keys(wire).sort()).toEqual(['createdAt', 'id', 'messages', 'title', 'updatedAt']);
  });
});
