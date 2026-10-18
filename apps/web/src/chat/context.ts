import type { ChatTurn } from '../engine/localEngine';
import type { Message } from './types';

/**
 * Fits a conversation into the model's context window: the system prompt
 * and the newest messages are kept, the oldest dropped, leaving room for the
 * reply. Token counts are estimated (~3.5 characters per token, plus a few
 * tokens of chat-template overhead per message), which errs on the safe side
 * for English and code.
 */

const CHARS_PER_TOKEN = 3.5;
const PER_MESSAGE_OVERHEAD = 6;
const SAFETY_MARGIN = 256;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN) + PER_MESSAGE_OVERHEAD;
}

export function buildContext(
  systemPrompt: string,
  messages: Pick<Message, 'role' | 'content'>[],
  contextSize: number,
  maxTokens: number,
): ChatTurn[] {
  let budget = contextSize - maxTokens - SAFETY_MARGIN - estimateTokens(systemPrompt);
  const kept: ChatTurn[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message.content) continue;
    const cost = estimateTokens(message.content);
    // Always keep the newest message, truncated from the front if it alone
    // is too long, so the user's question is never silently dropped.
    if (kept.length === 0 && cost > budget) {
      const chars = Math.max(0, Math.floor((budget - PER_MESSAGE_OVERHEAD) * CHARS_PER_TOKEN));
      kept.unshift({ role: message.role, content: message.content.slice(-chars) });
      break;
    }
    if (cost > budget) break;
    budget -= cost;
    kept.unshift({ role: message.role, content: message.content });
  }
  // A chat should open with a user turn; drop a leading orphaned reply.
  while (kept.length > 1 && kept[0].role === 'assistant') kept.shift();
  return [{ role: 'system', content: systemPrompt }, ...kept];
}
