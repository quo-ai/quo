import { GenerationStats } from '@/types/chat';

type NativeCompletionResult = import('llama.rn').NativeCompletionResult;

/**
 * Generation-stats assembly from native completion timings, plus merging of
 * stats across transparent continuation rounds.
 */

export function buildGenerationStats(
  result: NativeCompletionResult,
  startTime: number,
  contextSize: number,
): GenerationStats {
  const timings = result.timings || {};
  const promptTokens = timings.prompt_n || 0;
  const completionTokens = timings.predicted_n || 0;
  const generationTime = (timings.predicted_ms || 0) / 1000;
  const tokensPerSecond = timings.predicted_per_second ||
    (generationTime > 0 ? completionTokens / generationTime : 0);

  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    promptTime: (timings.prompt_ms || 0) / 1000,
    generationTime,
    totalTime: (Date.now() - startTime) / 1000,
    tokensPerSecond: Math.round(tokensPerSecond * 10) / 10,
    contextSize,
    contextUsed: Math.round((promptTokens / contextSize) * 100),
  };
}

/** Merge a continuation round's stats into the running combined stats. */
export function mergeGenerationStats(
  combined: GenerationStats,
  round: GenerationStats,
): GenerationStats {
  const completionTokens = combined.completionTokens + round.completionTokens;
  const generationTime = combined.generationTime + round.generationTime;
  return {
    ...round,
    promptTokens: combined.promptTokens + round.promptTokens,
    completionTokens,
    totalTokens: combined.totalTokens + round.totalTokens,
    promptTime: combined.promptTime + round.promptTime,
    generationTime,
    tokensPerSecond: Math.round((generationTime > 0 ? completionTokens / generationTime : 0) * 10) / 10,
  };
}
