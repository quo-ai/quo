import { Message, AppSettings, ToolAction, GenerationStats } from '@/types/chat';
import { llmService } from '@/services/llm';
import { mergeGenerationStats } from '@/services/llm/stats';
import { stripThinkBlocks } from '@/services/llm/prompt';
import { parseToolCalls, stripToolCalls, executeToolCalls, convertNativeToolCalls } from '@/services/tools';

export const MAX_TOOL_ITERATIONS = 3;

// Info tools that can only be called once per generation
const INFO_TOOLS = ['get_date', 'get_user_info'];

export interface ToolLoopParams {
  llmMessages: Message[];
  settings: AppSettings;
  contextSummary?: string | null;
  recallContext?: string | null;
  isPremium: boolean;
  onMemoryLimit: () => void;
  /** Returns true when this generation has been cancelled/superseded. */
  isCancelled: () => boolean;
  /** Called with tool-call-stripped content as tokens stream in. */
  onStreamUpdate: (cleanContent: string) => void;
}

export interface ToolLoopResult {
  /** True when the loop bailed because the generation was superseded. */
  cancelled: boolean;
  finalResponse: string;
  toolActions: ToolAction[];
  stats?: GenerationStats;
  continuationRounds: number;
  /** The native context died; the caller should mark the model unloaded. */
  modelUnloaded?: boolean;
}

// Tool loop: generate, execute tools, feed results back to model.
// Pure-ish orchestration around llmService.generate — all React state
// updates happen through the callbacks supplied by the caller.
export async function runToolLoop({
  llmMessages,
  settings,
  contextSummary,
  recallContext,
  isPremium,
  onMemoryLimit,
  isCancelled,
  onStreamUpdate,
}: ToolLoopParams): Promise<ToolLoopResult> {
  const allToolActions: ToolAction[] = [];
  let finalStats: GenerationStats | undefined = undefined;
  let totalContinuationRounds = 0;
  let conversationMessages = [...llmMessages];

  let iteration = 0;
  let needsFollowUp = true;
  // Guards against a model that repeats an already-used info tool every
  // round: each duplicate is chipped at most once, and after one
  // duplicates-only feedback round the loop exits with the visible text
  // instead of burning all iterations on identical feedback.
  let dupesOnlyRounds = 0;
  const notedDuplicateTools = new Set<string>();
  let finalResponse = '';

  // Track info tools that can only be called once per generation
  const usedInfoTools = new Set<string>();

  while (needsFollowUp && iteration < MAX_TOOL_ITERATIONS) {
    // Check if this generation was cancelled/superseded
    if (isCancelled()) {
      return { cancelled: true, finalResponse: '', toolActions: allToolActions, stats: finalStats, continuationRounds: totalContinuationRounds };
    }

    iteration++;
    let fullResponse = '';
    // Once a "[tool:" marker (case-insensitive, per stripToolCalls) shows up
    // we strip on every subsequent update; until then text passes through
    // untouched. Scanning only the new tail keeps the per-update cost
    // O(new text) instead of O(response).
    let sawToolMarker = false;

    const result = await llmService.generate(
      conversationMessages,
      settings,
      (text, done) => {
        if (done || isCancelled()) return;
        const scanFrom = Math.max(0, fullResponse.length - 8);
        fullResponse = text;
        if (!sawToolMarker && /\[tool:/i.test(text.slice(scanFrom))) {
          sawToolMarker = true;
        }
        onStreamUpdate(sawToolMarker ? stripToolCalls(text) : text);
      },
      { contextSummary, recallContext }
    );
    // A stop during generation must not go on to execute tool calls (e.g.
    // save a memory) found in the partial text.
    if (isCancelled()) {
      return { cancelled: true, finalResponse: '', toolActions: allToolActions, stats: finalStats, continuationRounds: totalContinuationRounds };
    }
    fullResponse = result.text;
    finalStats = finalStats && result.stats ? mergeGenerationStats(finalStats, result.stats) : result.stats ?? finalStats;
    totalContinuationRounds += result.continuationRounds ?? 0;
    if (result.modelUnloaded) {
      return {
        cancelled: false,
        finalResponse: stripToolCalls(fullResponse),
        toolActions: allToolActions,
        stats: finalStats,
        continuationRounds: totalContinuationRounds,
        modelUnloaded: true,
      };
    }

    // Check for native tool calls from llama.rn, then fall back to text-based parsing
    const toolCalls = result.nativeToolCalls?.length
      ? convertNativeToolCalls(result.nativeToolCalls)
      // Text-protocol calls count only in the answer, not in reasoning: a
      // model thinking "I could save_memory(...)" must not execute it.
      : parseToolCalls(stripThinkBlocks(fullResponse));

    if (toolCalls.length > 0) {
      // Filter out info tools that have already been used this generation
      const filteredToolCalls = toolCalls.filter(tc => {
        if (INFO_TOOLS.includes(tc.name) && usedInfoTools.has(tc.name)) {
          return false; // Skip - already used
        }
        return true;
      });

      // Track which info tools are being used
      toolCalls.forEach(tc => {
        if (INFO_TOOLS.includes(tc.name)) {
          usedInfoTools.add(tc.name);
        }
      });

      // Build results including "already used" messages for skipped tools
      const toolActions: ToolAction[] = [];
      for (const tc of toolCalls) {
        if (
          INFO_TOOLS.includes(tc.name) &&
          !filteredToolCalls.includes(tc) &&
          !notedDuplicateTools.has(tc.name)
        ) {
          // Tool was already used - add message (once per tool, not per round)
          notedDuplicateTools.add(tc.name);
          toolActions.push({
            type: 'info_query',
            name: tc.name,
            result: `Already checked this generation`,
          });
        }
      }

      // Execute the filtered tool calls
      if (filteredToolCalls.length > 0) {
        const executedActions = await executeToolCalls(filteredToolCalls, {
          isPremium,
          onMemoryLimit,
        });
        toolActions.push(...executedActions);
      }
      allToolActions.push(...toolActions);

      const strippedResponse = stripToolCalls(fullResponse);

      if (filteredToolCalls.length === 0) {
        dupesOnlyRounds++;
        if (dupesOnlyRounds >= 2) {
          // Second consecutive duplicates-only round — the feedback isn't
          // landing; stop looping and return the visible text we have.
          finalResponse = strippedResponse.trim().length > 0
            ? strippedResponse
            : 'I executed the tools but reached the iteration limit.';
          needsFollowUp = false;
          break;
        }
      } else {
        dupesOnlyRounds = 0;
      }

      // Check if model already provided a substantive response with the tool call
      // If so, no need for follow-up generation
      if (strippedResponse.trim().length > 20) {
        // Model already responded with the tool call
        finalResponse = strippedResponse;
        needsFollowUp = false;
      } else {
        // Model needs to see tool results and respond (e.g., save_memory confirmation)
        const toolResultsText = toolActions
          .map(a => `[${a.name}: ${a.result}]`)
          .join(' ');

        conversationMessages = [
          ...conversationMessages,
          { id: `temp-${iteration}`, role: 'assistant' as const, content: strippedResponse, timestamp: Date.now() },
          { id: `tool-${iteration}`, role: 'user' as const, content: toolResultsText, timestamp: Date.now() },
        ];
        needsFollowUp = true;
      }
    } else {
      // No tool calls - we're done
      finalResponse = stripToolCalls(fullResponse);
      needsFollowUp = false;
    }
  }

  // If we hit max iterations, use the last response
  if (iteration >= MAX_TOOL_ITERATIONS && !finalResponse) {
    finalResponse = 'I executed the tools but reached the iteration limit.';
  }

  return {
    cancelled: false,
    finalResponse,
    toolActions: allToolActions,
    stats: finalStats,
    continuationRounds: totalContinuationRounds,
  };
}
