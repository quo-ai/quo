import { describe, expect, it } from 'vitest';
import type { Message } from '../../chat/types';
import { moves, replyFacts, whereOf } from '../chat/Where';

let next = 0;
const ask = (content = 'Hi'): Message => ({ id: `u${next++}`, role: 'user', content } as Message);
const reply = (extra: Partial<Message> = {}): Message => ({ id: `a${next++}`, role: 'assistant', content: 'Hello', ...extra } as Message);

describe('where a reply was written', () => {
  it('is this device, the cloud through Quo, or the person’s own key', () => {
    expect(whereOf(reply())).toBe('device');
    expect(whereOf(reply({ cloud: true }))).toBe('cloud');
    expect(whereOf(reply({ own: 'OpenAI' }))).toBe('own');
  });

  it('marks the place a chat moved, just before the first message sent there, and the way back', () => {
    const toCloud = ask('Find tram times');
    const back = ask('Which day suits rain?');
    const chat = [ask(), reply({ modelName: 'Qwen3.5 2B' }), toCloud, reply({ cloud: true, modelName: 'GPT-6 Luna' }), back, reply({ modelName: 'Qwen3.5 2B' })];
    const found = moves(chat);
    expect([...found.keys()]).toEqual([toCloud.id, back.id]);
    expect(found.get(toCloud.id)).toEqual({ to: 'cloud', name: 'GPT-6 Luna', provider: undefined });
    expect(found.get(back.id)?.to).toBe('device');
  });

  it('does not mark a change between two cloud models, or the start of a chat', () => {
    const chat = [ask(), reply({ cloud: true, modelName: 'GPT-6 Luna' }), ask(), reply({ cloud: true, modelName: 'Claude Opus 5.5' })];
    expect(moves(chat).size).toBe(0);
  });

  it('marks a move between providers reached with the person’s own keys', () => {
    const second = ask();
    const chat = [ask(), reply({ own: 'OpenAI', modelName: 'GPT-6.1 Sol' }), second, reply({ own: 'Anthropic', modelName: 'Claude Opus 5.5' })];
    expect(moves(chat).get(second.id)).toEqual({ to: 'own', name: 'Claude Opus 5.5', provider: 'Anthropic' });
  });
});

describe('the facts under a reply', () => {
  it('name the exact model once: never as the name and again as a fact', () => {
    const facts = replyFacts(reply({ own: 'Anthropic', modelName: 'Sonnet', served: 'claude-sonnet-5-5', usage: { input: 2000, output: 200 } } as Partial<Message>));
    expect(facts).toEqual(['2.2k tokens']);
  });

  it('are separate items, never one string joined with dots', () => {
    expect(replyFacts(reply({ stats: { tokens: 200, tokensPerSecond: 41.63 } } as Partial<Message>))).toEqual(['41.6 tokens/s']);
    expect(replyFacts(reply({ cloud: true }))).toEqual(['Free']);
    expect(replyFacts(reply({ cloud: true, charged: 3 } as Partial<Message>))).toEqual(['3 credits']);
    expect(replyFacts(reply({ stopped: true } as Partial<Message>))).toEqual(['Stopped']);
    for (const facts of [replyFacts(reply({ cloud: true, charged: 1 } as Partial<Message>)), replyFacts(reply())]) for (const fact of facts) expect(fact).not.toContain('·');
  });
});
