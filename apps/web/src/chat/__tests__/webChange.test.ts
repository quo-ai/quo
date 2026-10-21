import { beforeEach, describe, expect, it } from 'vitest';
import type { AgentMessage } from '../../agent/types';
import { noteWebChange, resetWebChanges } from '../webChange';

const chat: AgentMessage[] = [
  { role: 'user', content: 'Can you web search for "Quo Offline AI"' },
  { role: 'assistant', content: 'I don’t have the ability to perform web searches.' },
  { role: 'user', content: 'How about now? Can you search the web' },
];

describe('web search turned on or off between messages', () => {
  beforeEach(resetWebChanges);

  it('says so in the newest message when it was turned on, so the model does not repeat its earlier “I can’t”', () => {
    expect(noteWebChange(chat.slice(0, 1), 'c1', false)).toEqual(chat.slice(0, 1));
    const sent = noteWebChange(chat, 'c1', true);
    expect(sent.at(-1)!.content).toBe('How about now? Can you search the web\n\n(Web search is on now: you can use web_search and fetch_url.)');
    expect(sent.slice(0, 2)).toEqual(chat.slice(0, 2));
  });

  it('says so when it was turned off', () => {
    noteWebChange(chat.slice(0, 1), 'c1', true);
    expect(noteWebChange(chat, 'c1', false).at(-1)!.content).toMatch(/\(Web search is off now: you cannot use web_search or fetch_url\.\)$/);
  });

  it('adds nothing when nothing changed, on a chat’s first message, or without a chat', () => {
    expect(noteWebChange(chat, 'c2', true)).toBe(chat);
    expect(noteWebChange(chat, 'c2', true)).toBe(chat);
    expect(noteWebChange(chat, undefined, true)).toBe(chat);
  });

  it('keeps each chat apart, and never changes what it was given (the note is only in what is sent)', () => {
    const before = JSON.stringify(chat);
    noteWebChange(chat, 'a', false);
    noteWebChange(chat, 'b', true);
    expect(noteWebChange(chat, 'a', false)).toBe(chat);
    expect(noteWebChange(chat, 'b', false).at(-1)!.content).toMatch(/off now/);
    expect(JSON.stringify(chat)).toBe(before);
  });
});
