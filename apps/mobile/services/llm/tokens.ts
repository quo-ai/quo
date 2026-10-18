import { Message } from '@/types/chat';
import { getBudgetTextForMessage } from './prompt';

/**
 * Token estimation and context-window fitting.
 */

export type EstimateTokensFn = (text: string) => Promise<number>;

/** Rough heuristic used when the native tokenizer is unavailable: 1 token ≈ 4 chars. */
export function heuristicTokenEstimate(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Trim conversation history to fit the active model context window and
 * compute a safe generation cap. This keeps the newest user turn while
 * aggressively shedding old history instead of relying on native ctx_shift.
 */
export async function fitMessagesToContext(
  messages: Message[],
  systemContent: string,
  requestedOutputTokens: number,
  contextSize: number,
  preserveReasoning: boolean,
  estimateTokens: EstimateTokensFn,
): Promise<{ messages: Message[]; maxTokens: number }> {
  if (messages.length === 0) {
    return { messages, maxTokens: requestedOutputTokens };
  }

  const hasImages = messages.some(message => Boolean(message.image));
  const safetyBuffer = hasImages ? 640 : 256;
  const provisionalOutputReserve = Math.min(
    Math.max(requestedOutputTokens, 256),
    Math.max(256, Math.floor(contextSize * 0.4)),
  );
  const systemTokens = await estimateTokens(`system: ${systemContent}`) + 8;
  const availablePromptTokens = Math.max(
    256,
    contextSize - systemTokens - provisionalOutputReserve - safetyBuffer,
  );

  const tokenizedMessages = await Promise.all(
    messages.map(async (message) => {
      const text = getBudgetTextForMessage(message, preserveReasoning);
      // Tokenize the bare text (+ a small constant for the role prefix and
      // template overhead) so the cache entry is shared with other callers
      // that count the same message.
      const tokenEstimate = text ? await estimateTokens(text) + 6 : 0;
      return { message, tokenEstimate };
    }),
  );

  const kept: Array<{ message: Message; tokenEstimate: number }> = [];
  let usedPromptTokens = 0;

  // Keep a contiguous tail: stop at the first message that doesn't fit rather
  // than skipping it, or older turns would survive around a dropped one and
  // break role alternation (two user turns in a row).
  for (let i = tokenizedMessages.length - 1; i >= 0; i--) {
    const entry = tokenizedMessages[i];
    const shouldKeepNewest = kept.length === 0;
    if (!shouldKeepNewest && usedPromptTokens + entry.tokenEstimate > availablePromptTokens) {
      break;
    }
    kept.push(entry);
    usedPromptTokens += entry.tokenEstimate;
  }

  kept.reverse();

  if (kept.length === 0) {
    const fallback = tokenizedMessages[tokenizedMessages.length - 1];
    kept.push(fallback);
    usedPromptTokens = fallback.tokenEstimate;
  }

  while (kept.length > 0 && kept[0].message.role === 'assistant') {
    usedPromptTokens -= kept[0].tokenEstimate;
    kept.shift();
  }

  while (kept.length > 1 && contextSize - systemTokens - usedPromptTokens - safetyBuffer < 128) {
    usedPromptTokens -= kept[0].tokenEstimate;
    kept.shift();
    while (kept.length > 0 && kept[0].message.role === 'assistant') {
      usedPromptTokens -= kept[0].tokenEstimate;
      kept.shift();
    }
  }

  if (kept.length === 0) {
    const fallback = tokenizedMessages[tokenizedMessages.length - 1];
    kept.push(fallback);
    usedPromptTokens = fallback.tokenEstimate;
  }

  const availableOutputTokens = Math.max(
    16,
    contextSize - systemTokens - usedPromptTokens - safetyBuffer,
  );
  const maxTokens = Math.max(16, Math.min(requestedOutputTokens, availableOutputTokens));

  return {
    messages: kept.map(entry => entry.message),
    maxTokens,
  };
}
