import { describe, expect, it } from 'vitest';
import { groupConversations } from '../groups';
import type { Conversation } from '../types';

const now = new Date('2026-10-06T15:00:00').getTime();
const DAY = 86_400_000;
const conv = (id: string, updatedAt: number, title = id, text = ''): Conversation => ({
  id, title, createdAt: updatedAt, updatedAt, messages: text ? [{ id: `${id}-m`, role: 'user', content: text }] : [],
});

describe('groupConversations', () => {
  it('buckets by recency, newest first, skipping empty groups', () => {
    const groups = groupConversations([
      conv('old', now - 60 * DAY),
      conv('today-early', now - 2 * 3_600_000),
      conv('today-late', now - 60_000),
      conv('yesterday', now - DAY),
      conv('week', now - 4 * DAY),
    ], now);
    expect(groups.map(g => g.label)).toEqual(['Today', 'Yesterday', 'Previous 7 days', 'Older']);
    expect(groups[0].items.map(c => c.id)).toEqual(['today-late', 'today-early']);
  });

  it('filters by title and message text, case-insensitively', () => {
    const list = [conv('a', now, 'Lisbon trip'), conv('b', now, 'Other', 'packing list for LISBON'), conv('c', now, 'Recipes')];
    const groups = groupConversations(list, now, 'lisbon');
    expect(groups.flatMap(g => g.items.map(c => c.id)).sort()).toEqual(['a', 'b']);
  });
});
