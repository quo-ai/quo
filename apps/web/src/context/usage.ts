import { estimateTokens, userText } from '../chat/context';
import type { Message } from '../chat/types';
import type { ModelChoice } from '../models';
import { AGENT_CONTEXT } from '../agent/local';
import { CLOUD_CONTEXT } from '../models';

/**
 * How full a model's memory is: the rules and tool list that always go first, plus the conversation. Counted by the
 * provider when it says (after a reply), otherwise estimated at 3.5 characters a token, so it errs a little high.
 */

export type ContextMode = 'chat' | 'web' | 'code';

export interface ContextUsage {
  used: number;
  /** The window, when known. */
  limit: number | null;
  /** The rules and tools that go first. */
  fixed: number;
  /** Counted by the provider rather than estimated. */
  exact: boolean;
}

/** About what the rules and the tool list cost in each mode. */
export const FIXED_TOKENS: Record<ContextMode, number> = { chat: 60, web: 700, code: 3000 };

/** The window this chat is using: what Quo loads or sends, not always what the model could take. */
export function contextWindow(choice: ModelChoice | null, mode: ContextMode): number | null {
  if (!choice) return null;
  if (choice.kind === 'local') return mode === 'code' ? AGENT_CONTEXT : choice.model.contextSize;
  if (choice.kind === 'cloud') return mode === 'chat' ? CLOUD_CONTEXT.contextSize : null;
  const known = choice.model.contextTokens;
  return mode === 'chat' ? Math.min(known ?? CLOUD_CONTEXT.contextSize, 64_000) : known ?? null;
}

/** What the conversation takes: the words of each message, attached documents included, and a rough count for photos. */
export function conversationTokens(messages: Pick<Message, 'role' | 'content' | 'attachments'>[]): number {
  return messages.reduce((sum, message) => sum + estimateTokens(message.role === 'user' ? userText(message) : message.content) + (message.attachments?.filter(a => a.kind === 'image').length ?? 0) * 800, 0);
}

export function contextUsage(choice: ModelChoice | null, mode: ContextMode, messages: Pick<Message, 'role' | 'content' | 'attachments'>[], live: { tokens: number; exact: boolean } | null): ContextUsage | null {
  if (!choice || (messages.length === 0 && !live)) return null;
  const fixed = FIXED_TOKENS[mode];
  return { used: live ? live.tokens + (live.exact ? 0 : fixed) : fixed + conversationTokens(messages), limit: contextWindow(choice, mode), fixed, exact: Boolean(live?.exact) };
}

export const ratio = (usage: ContextUsage): number | null => (usage.limit ? usage.used / usage.limit : null);

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
