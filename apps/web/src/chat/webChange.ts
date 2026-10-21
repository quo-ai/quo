import type { AgentMessage } from '../agent/types';

/**
 * Web search can be turned on or off between two messages of a chat (Settings → Web). The tools change with it, but the
 * conversation still holds the model's own earlier answer ("I can't search the web"), and a model may follow that answer
 * instead of the tools it now has. Measured with Qwen3.5 9B on a person's chat replayed through its own template: it
 * searched in 1 of 2 runs as it was, 2 of 2 with this line. So when the setting changed since the chat's last message,
 * the newest user message carries one line that says so. Only in what is sent: never stored; an unchanged setting adds nothing.
 */

const ON = '(Web search is on now: you can use web_search and fetch_url.)';
const OFF = '(Web search is off now: you cannot use web_search or fetch_url.)';

/** What each chat's model was offered last time: web tools or not. In memory: after a restart the first message says nothing. */
const offered = new Map<string, boolean>();

export function noteWebChange(conversation: AgentMessage[], chatId: string | undefined, webNow: boolean): AgentMessage[] {
  if (!chatId) return conversation;
  const before = offered.get(chatId);
  offered.set(chatId, webNow);
  if (before === undefined || before === webNow) return conversation;
  const last = conversation.findLastIndex(message => message.role === 'user');
  if (last < 0) return conversation;
  return conversation.map((message, index) => (index === last ? { ...message, content: `${message.content}\n\n${webNow ? ON : OFF}` } : message));
}

/** For tests: forget every chat. */
export const resetWebChanges = (): void => offered.clear();
