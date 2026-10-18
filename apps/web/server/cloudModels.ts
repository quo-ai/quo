import { config, features } from './env.js';
import { MILLI } from './credits.js';

/**
 * Cloud models (OpenRouter ids). Prices are USD per 1M tokens, used to
 * reserve credits up front; the actual charge uses OpenRouter's reported
 * cost for the request. 1 credit = $0.005 of model cost (2× markup).
 * Edit here to add models or change pricing; clients fetch /api/models.
 */

export const CREDIT_USD = 0.005;

export interface CloudModel {
  id: string;
  name: string;
  provider: string;
  description: string;
  usdIn: number;
  usdOut: number;
  supportsThinking: boolean;
  maxOutput: number;
}

const CATALOG: CloudModel[] = [
  { id: 'openai/gpt-6-luna', name: 'GPT-6 Luna', provider: 'OpenAI', description: 'Fast and capable for everyday questions.', usdIn: 0.1, usdOut: 0.5, supportsThinking: true, maxOutput: 4096 },
  { id: 'anthropic/claude-sonnet-5.5', name: 'Claude Sonnet 5.5', provider: 'Anthropic', description: 'Excellent writing, analysis and code.', usdIn: 2, usdOut: 10, supportsThinking: true, maxOutput: 8192 },
  { id: 'anthropic/claude-opus-5.5', name: 'Claude Opus 5.5', provider: 'Anthropic', description: 'Anthropic’s most capable model for deep work.', usdIn: 4, usdOut: 20, supportsThinking: true, maxOutput: 8192 },
  { id: 'anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5', provider: 'Anthropic', description: 'Quick, thoughtful replies at a low cost.', usdIn: 1, usdOut: 5, supportsThinking: true, maxOutput: 8192 },
  { id: 'anthropic/claude-fable-5.1', name: 'Claude Fable 5.1', provider: 'Anthropic', description: 'Frontier intelligence for the hardest problems.', usdIn: 10, usdOut: 50, supportsThinking: true, maxOutput: 8192 },
  { id: 'openai/gpt-6.1-sol', name: 'GPT-6.1 Sol', provider: 'OpenAI', description: 'Strong all-round reasoning and writing.', usdIn: 2, usdOut: 10, supportsThinking: true, maxOutput: 8192 },
  { id: 'openai/gpt-6-astra', name: 'GPT-6 Astra', provider: 'OpenAI', description: 'OpenAI’s frontier model.', usdIn: 10, usdOut: 50, supportsThinking: true, maxOutput: 8192 },
  // Priced at its 2027 rate (it doubles on 1 Jan 2027).
  { id: 'google/gemini-3.8-flash', name: 'Gemini 3.8 Flash', provider: 'Google', description: 'Fast, multilingual and great value.', usdIn: 1.5, usdOut: 7.5, supportsThinking: true, maxOutput: 8192 },
  { id: 'google/gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', provider: 'Google', description: 'Google’s most capable model (preview).', usdIn: 2, usdOut: 12, supportsThinking: true, maxOutput: 8192 },
  { id: 'deepseek/deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', provider: 'DeepSeek', description: 'Open model, quick and very low cost.', usdIn: 0.3, usdOut: 1.2, supportsThinking: true, maxOutput: 8192 },
  { id: 'moonshotai/kimi-k3', name: 'Kimi K3', provider: 'Moonshot', description: 'Open model with long, careful answers.', usdIn: 3, usdOut: 15, supportsThinking: true, maxOutput: 8192 },
  { id: 'qwen/qwen3.8-27b', name: 'Qwen3.8 27B', provider: 'Qwen', description: 'Open model, strong at code and languages.', usdIn: 0.425, usdOut: 2.55, supportsThinking: true, maxOutput: 8192 },
  { id: 'google/gemma-4-31b-it', name: 'Gemma 4 31B', provider: 'Google', description: 'Open model, light and efficient.', usdIn: 0.09, usdOut: 0.34, supportsThinking: false, maxOutput: 8192 },
];

export function cloudModels(): CloudModel[] {
  if (CATALOG.some(model => model.id === config.defaultCloudModel)) return CATALOG;
  // A default chosen via DEFAULT_CLOUD_MODEL that isn't listed above.
  return [{ id: config.defaultCloudModel, name: config.defaultCloudModel.split('/').pop()!, provider: config.defaultCloudModel.split('/')[0], description: 'Free to use every day.', usdIn: 0.5, usdOut: 2, supportsThinking: false, maxOutput: 4096 }, ...CATALOG];
}

export function getCloudModel(id: string): CloudModel | undefined {
  return cloudModels().find(model => model.id === id);
}

export const isFreeModel = (model: CloudModel) => model.id === config.defaultCloudModel;

/** Millicredits for a token count at catalog prices. */
export function estimateCost(model: CloudModel, inputTokens: number, outputTokens: number): number {
  const usd = (inputTokens * model.usdIn + outputTokens * model.usdOut) / 1e6;
  return Math.ceil((usd / CREDIT_USD) * MILLI);
}

/** Millicredits for an actual USD cost reported by OpenRouter. */
export const costToMillicredits = (usd: number) => Math.ceil((usd / CREDIT_USD) * MILLI);

/** What clients see: no internal prices, just what a typical message costs. */
export function publicCatalog() {
  // Paid models need an account to pay with; without accounts only the free one is offered.
  const available = !features.cloud ? [] : features.accounts ? cloudModels() : cloudModels().filter(isFreeModel);
  return {
    defaultModel: config.defaultCloudModel,
    models: available.map(model => ({
      id: model.id,
      name: model.name,
      provider: model.provider,
      description: model.description,
      free: isFreeModel(model),
      supportsThinking: model.supportsThinking,
      // A typical message: ~1,500 tokens in (with history), ~500 out.
      creditsPerMessage: Math.round(estimateCost(model, 1500, 500) / 100) / 10,
    })),
  };
}
