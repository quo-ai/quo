import { describe, expect, it } from 'vitest';
import { reconcileChat } from '../../sync/merge';
import { toWire } from '../../sync/adapters';
import type { Conversation, Message } from '../types';
import { changedFiles, cutFrom, laterMessages, restoreCut } from '../rewind';

const message = (id: string, role: Message['role'] = 'user', extra: Partial<Message> = {}): Message => ({ id, role, content: id, ...extra });
const chat = (...messages: Message[]): Conversation => ({ id: 'c1', title: 'Chat', createdAt: 1, updatedAt: 10, messages });

describe('going back in a chat', () => {
  it('removes the messages from a point, and records which, so sync keeps them removed', () => {
    const before = chat(message('a'), message('b', 'assistant'), message('c'), message('d', 'assistant'));
    const { conversation, removed } = cutFrom(before, 2, 50);
    expect(conversation.messages.map(m => m.id)).toEqual(['a', 'b']);
    expect(removed.map(m => m.id)).toEqual(['c', 'd']);
    expect(conversation).toMatchObject({ updatedAt: 50, x: { cut: { at: 50, ids: ['c', 'd'] } } });
    // Another device still has the old ending: it isn't brought back.
    expect(reconcileChat(toWire(conversation), toWire(before), () => 'copy').item.messages.map(m => m.id)).toEqual(['a', 'b']);
    // A second cut adds to the record.
    expect(cutFrom(conversation, 1, 60).conversation.x).toEqual({ cut: { at: 60, ids: ['c', 'd', 'b'] } });
  });

  it('cutting nothing, or from nowhere, changes nothing', () => {
    const before = chat(message('a'));
    expect(cutFrom(before, 1)).toEqual({ conversation: before, removed: [] });
    expect(cutFrom(before, -1)).toEqual({ conversation: before, removed: [] });
  });

  it('undo brings the messages back as new ones, which sync then keeps', () => {
    const before = chat(message('a'), message('b', 'assistant'), message('c'));
    const { conversation, removed } = cutFrom(before, 1, 50);
    let n = 0;
    const back = restoreCut(conversation, removed, 70, () => `new-${++n}`);
    expect(back.messages.map(m => [m.id, m.content])).toEqual([['a', 'a'], ['new-1', 'b'], ['new-2', 'c']]);
    expect(back.updatedAt).toBe(70);
    // The server has the cut version: the restored messages win and go up.
    const merged = reconcileChat(toWire(back), toWire(conversation), () => 'copy');
    expect(merged.item.messages.map(m => m.id)).toEqual(['a', 'new-1', 'new-2']);
    expect(merged.pushNeeded).toBe(true);
  });

  it('knows when removed replies changed files, and counts what an edit would remove', () => {
    const edited = message('r', 'assistant', { steps: [{ id: 's', tool: 'edit_file', title: 'Edited a.ts', status: 'done', detail: { kind: 'diff', body: '' } }] });
    const read = message('q', 'assistant', { steps: [{ id: 's', tool: 'read_file', title: 'Read a.ts', status: 'done' }] });
    expect(changedFiles([edited])).toBe(true);
    expect(changedFiles([read, message('x')])).toBe(false);
    const list = [message('a'), message('b', 'assistant'), message('n', 'assistant', { summary: true }), message('c')];
    expect(laterMessages(list, 0)).toBe(2);
    expect(laterMessages(list, 3)).toBe(0);
  });
});
