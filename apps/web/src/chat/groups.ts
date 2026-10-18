import type { Conversation } from './types';

export interface ConversationGroup {
  label: string;
  items: Conversation[];
}

const DAY = 24 * 60 * 60 * 1000;

/** Today / Yesterday / Previous 7 days / Previous 30 days / Older, newest first. */
export function groupConversations(conversations: Conversation[], now: number, query = ''): ConversationGroup[] {
  const q = query.trim().toLowerCase();
  const matches = q
    ? conversations.filter(c => c.title.toLowerCase().includes(q) || c.messages.some(m => m.content.toLowerCase().includes(q)))
    : conversations;

  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  const buckets: [string, (t: number) => boolean][] = [
    ['Today', t => t >= startOfToday],
    ['Yesterday', t => t >= startOfToday - DAY],
    ['Previous 7 days', t => t >= startOfToday - 7 * DAY],
    ['Previous 30 days', t => t >= startOfToday - 30 * DAY],
    ['Older', () => true],
  ];

  const groups: ConversationGroup[] = buckets.map(([label]) => ({ label, items: [] }));
  for (const conversation of [...matches].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const index = buckets.findIndex(([, test]) => test(conversation.updatedAt));
    groups[index].items.push(conversation);
  }
  return groups.filter(group => group.items.length > 0);
}
