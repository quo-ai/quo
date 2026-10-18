import { AppSettings } from '@/types/chat';
import { ModelConfig } from '@/constants/models';

/**
 * Sampling-parameter resolution, shared by the text and vision paths.
 * Values come from each model's vendor-recommended settings
 * (constants/models.ts); thinking mode layers the model's thinking profile
 * on top.
 */

export interface CompletionParams {
  temperature: number;
  topP: number;
  topK: number;
  minP: number;
  presencePenalty: number;
  repeatPenalty: number;
  penaltyLastN: number;
  maxTokens: number;
  contextSize: number;
  isThinkingMode: boolean;
  /** Max reasoning tokens before the model must answer (thinking mode). */
  thinkingBudget: number;
}

// Reasoning cap: small models in particular can deliberate at length on a
// phone CPU (a top complaint in reviews), so thinking is closed off after a
// budget and the model answers. Larger models get more room.
const SMALL_MODEL_MAX_BYTES = 1_500_000_000;
const THINKING_BUDGET_SMALL = 1024;
const THINKING_BUDGET_LARGE = 2048;

export function resolveCompletionParams(
  model: ModelConfig,
  settings: AppSettings,
): CompletionParams {
  const modelSettings = model.recommendedSettings;
  const contextSize = modelSettings.contextSize || 8192;

  // Reasoning checkpoints always think; hybrid models think when the user
  // turns it on.
  const supportsThinking = model.features.includes('thinking');
  const isThinkingMode = Boolean(model.alwaysThinks)
    || (Boolean(settings.enableThinking) && supportsThinking);

  const thinking = isThinkingMode ? model.thinkingSettings : undefined;
  // The user's temperature (Settings) applies to normal replies; thinking
  // mode uses the vendor's thinking profile, which is tuned for reasoning.
  const temperature = thinking?.temperature ?? settings.temperature ?? modelSettings.temperature;

  const maxTokens = Math.min(
    settings.maxTokens || modelSettings.maxTokens || 2048,
    modelSettings.maxTokens || 32768,
    Math.max(256, contextSize - 1024),
  );

  return {
    temperature,
    topP: thinking?.topP ?? modelSettings.topP ?? 0.95,
    topK: thinking?.topK ?? modelSettings.topK ?? 40,
    minP: thinking?.minP ?? modelSettings.minP ?? 0.05,
    presencePenalty: thinking?.presencePenalty ?? modelSettings.presencePenalty ?? 0,
    repeatPenalty: modelSettings.repeatPenalty ?? 1.0,
    penaltyLastN: modelSettings.penaltyLastN ?? 64,
    maxTokens,
    contextSize,
    isThinkingMode,
    thinkingBudget: model.sizeBytes > 0 && model.sizeBytes <= SMALL_MODEL_MAX_BYTES
      ? THINKING_BUDGET_SMALL
      : THINKING_BUDGET_LARGE,
  };
}
