/**
 * Repairs assistant messages corrupted by a streaming bug in earlier
 * versions (≤ 1.4.0): llama.rn reports the *accumulated* reasoning on every
 * token, but the old code appended it as if it were new, wrapping the whole
 * reasoning-so-far in a fresh <think> block per token and then appending the
 * token's raw text. A thinking-mode reply grew quadratically (megabytes),
 * which ran the Android text layout out of memory every time the chat was
 * opened — including at launch, since the latest chat opens automatically.
 *
 * Shape: (<think>REASONING_SO_FAR</think>RAW_TOKEN)×n. The last block holds
 * the complete reasoning; the text outside the blocks is the raw output in
 * order (reasoning, a literal </think>, then the answer).
 */

/** More think blocks than any genuine reply produces (it has at most one). */
const CORRUPTION_BLOCK_THRESHOLD = 3;
/** Hard ceiling so no single message can exhaust the UI's text layout. */
export const MAX_MESSAGE_CHARS = 100_000;

const THINK_BLOCK = /<think>[\s\S]*?<\/think>/g;

export function repairAssistantContent(content: string): string {
  let repaired = content;

  const blocks = content.match(THINK_BLOCK);
  if (blocks && blocks.length > CORRUPTION_BLOCK_THRESHOLD) {
    const reasoning = blocks[blocks.length - 1].slice('<think>'.length, -'</think>'.length);
    const raw = content.replace(THINK_BLOCK, '');
    const close = raw.lastIndexOf('</think>');
    const answer = close >= 0 ? raw.slice(close + '</think>'.length) : '';
    repaired = `<think>${reasoning.trim()}</think>${answer.trim()}`;
  }

  if (repaired.length > MAX_MESSAGE_CHARS) {
    repaired = `${repaired.slice(0, MAX_MESSAGE_CHARS)}\n\n[Message truncated]`;
  }
  return repaired;
}
