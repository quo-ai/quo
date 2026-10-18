import { config, features } from './env.js';
import { MILLI } from './credits.js';

/**
 * Cloud models (OpenRouter ids). Prices are USD per 1M tokens, used to
 * reserve credits up front; the actual charge uses OpenRouter's reported
 * cost for the request. 1 credit = $0.005 of model cost (2× markup).
 * Edit here to add models or change pricing; clients fetch /api/models.
 */

export const CREDIT_USD = 0.005;

/**
 * `frontier`: the most capable models, shown locked behind the paywall until
 * the person has credits. `everyday`: quick and cheap, including the free one.
 */
export type ModelTier = 'frontier' | 'everyday';

export interface CloudModel {
  id: string;
  name: string;
  provider: string;
  description: string;
  tier: ModelTier;
  /** Can run Code mode: reliable tool use, and strong enough at code to be worth the credits. */
  agent: boolean;
  /** When the model came out (ISO date), so the picker can mark new ones. */
  released: string;
  usdIn: number;
  usdOut: number;
  supportsThinking: boolean;
  maxOutput: number;
}

// Listed in the order people see them, checked against OpenRouter on 18 Oct 2026. Every id must exist there
// (server/__tests__/cloudModels.test.ts checks the shape, not the ids). Prices: a closed model's list price;
// a model many hosts serve (the open ones) at about the median host's price, never the cheapest, because
// these figures reserve credits before a reply and tell people what a message costs. Too low a figure would
// have Quo covering the difference.
const CATALOG: CloudModel[] = [
  { id: 'openai/gpt-6-luna', name: 'GPT-6 Luna', provider: 'OpenAI', description: 'Fast and capable for everyday questions.', agent: false, tier: 'everyday', released: '2026-09-22', usdIn: 0.1, usdOut: 0.5, supportsThinking: true, maxOutput: 4096 },

  // Frontier
  { id: 'anthropic/claude-fable-5.1', name: 'Claude Fable 5.1', provider: 'Anthropic', description: 'Frontier intelligence for the hardest problems.', agent: true, tier: 'frontier', released: '2026-09-01', usdIn: 10, usdOut: 50, supportsThinking: true, maxOutput: 8192 },
  { id: 'openai/gpt-6-astra', name: 'GPT-6 Astra', provider: 'OpenAI', description: 'OpenAI’s frontier model.', agent: true, tier: 'frontier', released: '2026-09-04', usdIn: 10, usdOut: 50, supportsThinking: true, maxOutput: 8192 },
  { id: 'google/gemini-4-argon', name: 'Gemini 4 Argon', provider: 'Google', description: 'Google’s flagship for code, maths and long, multi-step work, with a million-token memory.', agent: true, tier: 'frontier', released: '2026-10-13', usdIn: 2, usdOut: 10, supportsThinking: true, maxOutput: 8192 },
  { id: 'anthropic/claude-opus-5.5', name: 'Claude Opus 5.5', provider: 'Anthropic', description: 'Anthropic’s most capable model for deep work.', agent: true, tier: 'frontier', released: '2026-09-22', usdIn: 4, usdOut: 20, supportsThinking: true, maxOutput: 8192 },
  { id: 'openai/gpt-6.1-sol', name: 'GPT-6.1 Sol', provider: 'OpenAI', description: 'Strong all-round reasoning and writing.', agent: true, tier: 'frontier', released: '2026-09-29', usdIn: 2, usdOut: 10, supportsThinking: true, maxOutput: 8192 },
  { id: 'anthropic/claude-sonnet-5.5', name: 'Claude Sonnet 5.5', provider: 'Anthropic', description: 'Excellent writing, analysis and code.', agent: true, tier: 'frontier', released: '2026-09-28', usdIn: 2, usdOut: 10, supportsThinking: true, maxOutput: 8192 },
  { id: 'x-ai/grok-4.7', name: 'Grok 4.7', provider: 'xAI', description: 'Sharp, direct reasoning with a very long memory.', agent: true, tier: 'frontier', released: '2026-09-21', usdIn: 2.2, usdOut: 6.6, supportsThinking: true, maxOutput: 8192 },
  { id: 'qwen/qwen3.8-max-prime', name: 'Qwen3.8 Max Prime', provider: 'Qwen', description: 'Alibaba’s flagship, strong at code and languages.', agent: true, tier: 'frontier', released: '2026-09-23', usdIn: 4, usdOut: 12, supportsThinking: true, maxOutput: 8192 },
  { id: 'z-ai/glm-5.3-prime', name: 'GLM 5.3 Prime', provider: 'Z.ai', description: 'Z.ai’s flagship for long, multi-step tasks and code.', agent: true, tier: 'frontier', released: '2026-09-23', usdIn: 2.8, usdOut: 8.8, supportsThinking: true, maxOutput: 8192 },
  { id: 'moonshotai/kimi-k3', name: 'Kimi K3', provider: 'Moonshot', description: 'Open model with long, careful answers.', agent: true, tier: 'frontier', released: '2026-07-16', usdIn: 2.6, usdOut: 15, supportsThinking: true, maxOutput: 8192 },
  { id: 'mistralai/mistral-large-4-0', name: 'Mistral Large 4', provider: 'Mistral', description: 'Mistral’s flagship: precise, multilingual and good value.', agent: true, tier: 'frontier', released: '2026-10-06', usdIn: 0.7, usdOut: 2.1, supportsThinking: true, maxOutput: 8192 },
  { id: 'deepseek/deepseek-v4-pro-0813', name: 'DeepSeek V4 Pro', provider: 'DeepSeek', description: 'Open model with top-tier reasoning and code, at a fraction of the price.', agent: true, tier: 'frontier', released: '2026-08-12', usdIn: 0.96, usdOut: 3.2, supportsThinking: true, maxOutput: 8192 },

  // Everyday
  { id: 'anthropic/claude-haiku-5.5', name: 'Claude Haiku 5.5', provider: 'Anthropic', description: 'Quick, thoughtful replies at a very low cost.', agent: true, tier: 'everyday', released: '2026-10-07', usdIn: 0.1, usdOut: 0.5, supportsThinking: true, maxOutput: 8192 },
  // Priced at its 2027 rate (it doubles on 1 Jan 2027).
  { id: 'google/gemini-3.8-flash', name: 'Gemini 3.8 Flash', provider: 'Google', description: 'Fast, multilingual and great value.', agent: true, tier: 'everyday', released: '2026-09-02', usdIn: 1.65, usdOut: 8.25, supportsThinking: true, maxOutput: 8192 },
  { id: 'deepseek/deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', provider: 'DeepSeek', description: 'Open model, quick and very low cost.', agent: true, tier: 'everyday', released: '2026-09-10', usdIn: 0.3, usdOut: 1.2, supportsThinking: true, maxOutput: 8192 },
  { id: 'qwen/qwen3.8-27b', name: 'Qwen3.8 27B', provider: 'Qwen', description: 'Open model, strong at code and languages.', agent: false, tier: 'everyday', released: '2026-08-14', usdIn: 0.425, usdOut: 2.55, supportsThinking: true, maxOutput: 8192 },
  { id: 'google/gemma-4-31b-it', name: 'Gemma 4 31B', provider: 'Google', description: 'Open model, light and efficient.', agent: false, tier: 'everyday', released: '2026-04-02', usdIn: 0.2, usdOut: 0.4, supportsThinking: false, maxOutput: 8192 },
];

export function cloudModels(): CloudModel[] {
  if (CATALOG.some(model => model.id === config.defaultCloudModel)) return CATALOG;
  // A default chosen via DEFAULT_CLOUD_MODEL that isn't listed above.
  return [{ id: config.defaultCloudModel, name: config.defaultCloudModel.split('/').pop()!, provider: config.defaultCloudModel.split('/')[0], description: 'Free to use every day.', agent: false, tier: 'everyday', released: '2026-01-01', usdIn: 0.5, usdOut: 2, supportsThinking: false, maxOutput: 4096 }, ...CATALOG];
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
  // Everything is listed so people can see what's coming; paid models answer
  // with `setup_required` until accounts exist (see chat.ts).
  const available = features.cloud ? cloudModels() : [];
  return {
    defaultModel: config.defaultCloudModel,
    models: available.map(model => ({
      id: model.id,
      name: model.name,
      provider: model.provider,
      description: model.description,
      free: isFreeModel(model),
      tier: model.tier,
      agent: model.agent,
      released: model.released,
      supportsThinking: model.supportsThinking,
      // A typical message: ~1,500 tokens in (with history), ~500 out.
      // Two decimals: the cheapest models cost a few hundredths of a credit.
      creditsPerMessage: Math.round(estimateCost(model, 1500, 500) / 10) / 100,
    })),
  };
}
