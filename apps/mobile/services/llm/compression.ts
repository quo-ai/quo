import { Message } from '@/types/chat';
import { stripReasoningTags, stripThinkBlocks } from './prompt';
import { EstimateTokensFn } from './tokens';

/**
 * Context-compression helpers: old messages get folded into a rolling summary
 * once the live history crosses the threshold, always keeping a recent tail
 * of messages live in the prompt. The stateful orchestration (native-context
 * ownership, abort flags) stays in LLMService; the text shaping lives here.
 */

// Context-compression tuning
export const KEEP_RECENT_MESSAGES = 6;
export const COMPRESS_THRESHOLD_RATIO = 0.5;
export const SUMMARY_MAX_TOKENS = 256;

/**
 * Estimate the token size of the live (uncompressed) portion of the history,
 * including the existing rolling summary when present.
 */
export async function estimateLiveTokens(
  messages: Message[],
  covered: number,
  existingSummaryText: string | undefined,
  estimateTokens: EstimateTokensFn,
): Promise<number> {
  const estimates = await Promise.all([
    existingSummaryText ? estimateTokens(existingSummaryText) : Promise.resolve(0),
    ...messages.slice(covered).map(msg => estimateTokens(msg.content).then(n => n + 4)),
  ]);
  return estimates.reduce((sum, n) => sum + n, 0);
}

/** Plain-text transcript of the messages being folded into the summary. */
export function buildCompressionTranscript(
  messages: Message[],
  covered: number,
  candidateEnd: number,
): string {
  return messages
    .slice(covered, candidateEnd)
    .map(msg => {
      let content = stripThinkBlocks(msg.content).trim();
      if (msg.image) content = `[image attached] ${content}`.trim();
      if (msg.document) content = `[document: ${msg.document.name}] ${content}`.trim();
      return content ? `${msg.role === 'user' ? 'User' : 'Assistant'}: ${content}` : '';
    })
    .filter(Boolean)
    .join('\n');
}

/**
 * Keep the summarization prompt itself within the context window, preferring
 * the newest part of the block when it is too large.
 */
export async function fitTranscriptToBudget(
  transcript: string,
  contextSize: number,
  estimateTokens: EstimateTokensFn,
): Promise<string> {
  const promptBudget = Math.max(512, contextSize - SUMMARY_MAX_TOKENS - 768);
  const transcriptTokens = await estimateTokens(transcript);
  if (transcriptTokens > promptBudget) {
    const keepRatio = promptBudget / transcriptTokens;
    const keepChars = Math.floor(transcript.length * keepRatio);
    return `[earlier content omitted]\n${transcript.slice(transcript.length - keepChars)}`;
  }
  return transcript;
}

/** The user-turn instruction for the summarization completion. */
export function buildSummaryInstruction(
  existingSummaryText: string | undefined,
  transcript: string,
): string {
  return existingSummaryText
    ? `Existing summary of the conversation so far:\n${existingSummaryText}\n\nNew conversation excerpt to fold into the summary:\n${transcript}\n\nWrite one updated summary (at most 150 words) that merges both. Capture key facts, names, numbers, decisions, user preferences, and open questions. Reply with only the summary.`
    : `Conversation excerpt:\n${transcript}\n\nSummarize it in at most 150 words. Capture key facts, names, numbers, decisions, user preferences, and open questions. Reply with only the summary.`;
}

/** Clean the raw summarization output into the stored summary text. */
export function cleanSummaryText(rawText: string, stripInternalTags: boolean): string {
  return stripReasoningTags(stripThinkBlocks(rawText), stripInternalTags).slice(0, 4000);
}
