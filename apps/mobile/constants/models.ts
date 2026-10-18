import { getSystemPrompt } from './system-prompts';
import { customModelService, CustomModelConfig } from '@/services/customModelService';

export type ModelFeature = 'reasoning' | 'multilingual' | 'code' | 'thinking' | 'tools' | 'vision' | 'agentic';

export interface RecommendedSettings {
  temperature: number;
  maxTokens: number;
  contextSize: number;
  topP?: number;
  topK?: number;
  minP?: number;
  presencePenalty?: number;
  repeatPenalty?: number;
  penaltyLastN?: number;
  nBatch?: number;
  nThreads?: number;
  nGpuLayers?: number;
  flashAttn?: 'auto' | 'on' | 'off';
  cacheTypeK?: 'f16' | 'f32' | 'q8_0' | 'q4_0' | 'q4_1' | 'iq4_nl' | 'q5_0' | 'q5_1';
  cacheTypeV?: 'f16' | 'f32' | 'q8_0' | 'q4_0' | 'q4_1' | 'iq4_nl' | 'q5_0' | 'q5_1';
}

export interface ModelConfig {
  id: string;
  name: string;
  description: string;
  size: string;
  sizeBytes: number;
  modelUrl: string;
  modelFilename: string;
  hasVision: boolean;
  mmprojUrl?: string;
  mmprojFilename?: string;
  mmprojSizeBytes?: number;
  recommendedSettings: RecommendedSettings;
  systemPrompt: string;
  features: ModelFeature[];
  stopSequences: string[];
  // Optional MTP draft head published with the model (multi-token
  // prediction): with Speed Boost on, llama.rn drafts tokens with it and
  // verifies them in one pass. Only list it when it measurably helps on
  // phone CPUs — Gemma 4 E2B's measured ~4% (Galaxy S24+, Oct 2026), not
  // worth a 98MB download, so it isn't offered.
  mtpDraft?: { url: string; filename: string; sizeBytes: number };
  // Smaller same-family model usable for speculative decoding (must share
  // the tokenizer). Only applied when the user enables Speed Boost and the
  // draft model is downloaded.
  draftModelId?: string;
  // Family capabilities, set per catalog entry rather than inferred from the
  // id so custom models never inherit behavior from their name.
  // True when the model reuses its reasoning: keep <think> blocks in chat
  // history instead of stripping them (Ministral family).
  preservesReasoningHistory?: boolean;
  // True when the model emits internal XML stage tags (<imagine>, <mood>, …)
  // that must be stripped from visible output and summaries (Nanbeige).
  emitsInternalReasoningTags?: boolean;
  // Vendor sampling for thinking mode, applied over recommendedSettings
  // when the user turns thinking on (or always, for alwaysThinks models).
  thinkingSettings?: Partial<RecommendedSettings>;
  // Reasoning checkpoint that always thinks (no toggle): its reasoning is
  // always parsed into the thinking block (Ministral Reasoning, Nanbeige).
  alwaysThinks?: boolean;
  // How the model calls tools. 'native': tool definitions go through the
  // model's own chat template and llama.rn returns parsed tool_calls
  // (grammar-constrained). 'text': the [TOOL:...] protocol described in the
  // system prompt, for templates without tool support. 'none': no tools.
  toolFormat: ToolFormat;
}

export type ToolFormat = 'native' | 'text' | 'none';

// Shared defaults; models only override what differs.
const BASE_SETTINGS: RecommendedSettings = {
  temperature: 0.6,
  maxTokens: 2048,
  contextSize: 8192,
  topP: 0.95,
  topK: 40,
  minP: 0.05,
  // Every vendor in the catalog recommends 1.0 (off); a multiplicative
  // repeat penalty degrades lists, code and JSON on small models.
  repeatPenalty: 1.0,
  penaltyLastN: 64,
  nBatch: 512,
  nThreads: 4,
  nGpuLayers: 60,
  flashAttn: 'auto',
  cacheTypeK: 'f16',
  cacheTypeV: 'f16',
};

// Qwen3.5 non-thinking sampling. The 0.8B/2B cards suggest temp 1.0 /
// top_p 1.0, but user reviews flagged inconsistent answers, so normal chat
// uses the 4B card's steadier 0.7 / 0.8 across the family. Presence is 1.5
// (cards: up to 2.0) since llama.cpp applies it over a recent-token window
// rather than the whole output, and high values can cause language mixing.
const QWEN_SETTINGS: RecommendedSettings = {
  ...BASE_SETTINGS,
  temperature: 0.7,
  topP: 0.8,
  topK: 20,
  minP: 0,
  presencePenalty: 1.5,
  penaltyLastN: 256,
  nBatch: 512,
  nThreads: 4,
  maxTokens: 2048,
};

// Qwen3.5 thinking mode (general tasks): temp 1.0, top_p 0.95, top_k 20.
const QWEN_THINKING: Partial<RecommendedSettings> = {
  temperature: 1.0,
  topP: 0.95,
  topK: 20,
  minP: 0,
  presencePenalty: 1.5,
};

const STOP_CHATML = ['<|im_end|>'];
const STOP_MISTRAL = ['</s>', '<|im_end|>', '<|eot_id|>'];
const STOP_QWEN = ['<|im_end|>', '<|endoftext|>'];

const HF = 'https://huggingface.co';

export const DEFAULT_MODEL_ID = 'qwen35-0.8b';

export const AVAILABLE_MODELS: ModelConfig[] = [
  {
    id: 'nanbeige4-3b-thinking',
    alwaysThinks: true,
    toolFormat: 'native',
    emitsInternalReasoningTags: true,
    name: 'Nanbeige4 Thinking (3B)',
    description: 'Deep thinker in a small package. Great writing, reasoning, and analysis.',
    size: '2.44 GB',
    sizeBytes: 2443112896,
    modelUrl: `${HF}/bartowski/Nanbeige_Nanbeige4-3B-Thinking-2511-GGUF/resolve/main/Nanbeige_Nanbeige4-3B-Thinking-2511-Q4_K_M.gguf?download=true`,
    modelFilename: 'Nanbeige_Nanbeige4-3B-Thinking-2511-Q4_K_M.gguf',
    hasVision: false,
    recommendedSettings: { ...BASE_SETTINGS, temperature: 0.6, topP: 0.95, minP: 0 },
    systemPrompt: getSystemPrompt('nanbeige4-3b-thinking'),
    features: ['reasoning', 'multilingual', 'code', 'thinking', 'tools'],
    stopSequences: STOP_CHATML,
  },
  {
    id: 'smollm3-3b',
    toolFormat: 'text',
    name: 'SmolLM3 (3B)',
    description: 'Strong compact text model with broad European language support. Good for writing, coding, and analysis.',
    size: '1.92 GB',
    sizeBytes: 1915305312,
    modelUrl: `${HF}/ggml-org/SmolLM3-3B-GGUF/resolve/main/SmolLM3-Q4_K_M.gguf?download=true`,
    modelFilename: 'SmolLM3-Q4_K_M.gguf',
    hasVision: false,
    recommendedSettings: {
      ...BASE_SETTINGS,
      temperature: 0.6,
      topP: 0.95,
      maxTokens: 2048,
      contextSize: 8192,
      nBatch: 384,
      nGpuLayers: 48,
    },
    systemPrompt: getSystemPrompt('smollm3-3b'),
    features: ['reasoning', 'multilingual', 'code', 'thinking', 'tools'],
    stopSequences: STOP_CHATML,
  },
  {
    id: 'ministral-3b-instruct',
    toolFormat: 'native',
    preservesReasoningHistory: true,
    name: 'Ministral (3B)',
    description: 'Free vision model. Send a photo and ask anything about it.',
    size: '2.0 GB',
    sizeBytes: 2147023008,
    modelUrl: `${HF}/mistralai/Ministral-3-3B-Instruct-2512-GGUF/resolve/main/Ministral-3-3B-Instruct-2512-Q4_K_M.gguf?download=true`,
    modelFilename: 'Ministral-3-3B-Instruct-2512-Q4_K_M.gguf',
    hasVision: true,
    mmprojUrl: `${HF}/mistralai/Ministral-3-3B-Instruct-2512-GGUF/resolve/main/Ministral-3-3B-Instruct-2512-BF16-mmproj.gguf?download=true`,
    mmprojFilename: 'Ministral-3-3B-Instruct-2512-mmproj.gguf',
    mmprojSizeBytes: 841501856,
    recommendedSettings: {
      ...BASE_SETTINGS,
      temperature: 0.1,
      maxTokens: 2048,
      topP: 0.9,
      nBatch: 384,
      nGpuLayers: 48,
    },
    systemPrompt: getSystemPrompt('ministral-3b-instruct'),
    features: ['vision', 'multilingual', 'code', 'tools'],
    stopSequences: STOP_MISTRAL,
  },
  {
    id: 'ministral-3b-reasoning',
    alwaysThinks: true,
    toolFormat: 'native',
    preservesReasoningHistory: true,
    name: 'Ministral Reasoning (3B)',
    description: 'Vision + deep reasoning and vast knowledge. Analyse images, documents, and complex problems.',
    size: '2.4 GB',
    sizeBytes: 2474177184,
    modelUrl: `${HF}/mistralai/Ministral-3-3B-Reasoning-2512-GGUF/resolve/main/Ministral-3-3B-Reasoning-2512-Q5_K_M.gguf?download=true`,
    modelFilename: 'Ministral-3-3B-Reasoning-2512-Q5_K_M.gguf',
    hasVision: true,
    mmprojUrl: `${HF}/mistralai/Ministral-3-3B-Reasoning-2512-GGUF/resolve/main/Ministral-3-3B-Reasoning-2512-BF16-mmproj.gguf?download=true`,
    mmprojFilename: 'Ministral-3-3B-Reasoning-2512-mmproj.gguf',
    mmprojSizeBytes: 841501856,
    recommendedSettings: {
      ...BASE_SETTINGS,
      temperature: 0.7,
      maxTokens: 1536,
      contextSize: 4096,
      topP: 0.95,
      nBatch: 384,
      nGpuLayers: 48,
      flashAttn: 'off',
    },
    systemPrompt: getSystemPrompt('ministral-3b-reasoning'),
    features: ['vision', 'reasoning', 'multilingual', 'code', 'tools', 'agentic'],
    stopSequences: STOP_MISTRAL,
  },
  // Qwen 3.5 Small Series (March 2026)
  // Hybrid Gated DeltaNet + Attention architecture, native multimodal,
  // 262K context, 201 languages, integrated reasoning.
  {
    id: 'qwen35-0.8b',
    thinkingSettings: QWEN_THINKING,
    toolFormat: 'native',
    name: 'Qwen3.5 (0.8B)',
    description: 'Recommended starter model. Ultra-light, fast, and best for quick offline setup on most phones.',
    size: '0.53 GB',
    sizeBytes: 532517120,
    modelUrl: `${HF}/unsloth/Qwen3.5-0.8B-GGUF/resolve/main/Qwen3.5-0.8B-Q4_K_M.gguf?download=true`,
    modelFilename: 'Qwen3.5-0.8B-Q4_K_M.gguf',
    hasVision: false,
    recommendedSettings: {
      ...QWEN_SETTINGS,
      maxTokens: 2048,
      contextSize: 8192,
      nBatch: 384,
      nThreads: 4,
    },
    systemPrompt: getSystemPrompt('qwen35-0.8b'),
    features: ['reasoning', 'multilingual', 'code', 'thinking', 'tools', 'agentic'],
    stopSequences: STOP_QWEN,
  },
  {
    id: 'qwen35-2b',
    thinkingSettings: QWEN_THINKING,
    toolFormat: 'native',
    name: 'Qwen3.5 (2B)',
    description: 'Free balanced upgrade with stronger reasoning and coding while still staying compact.',
    size: '1.28 GB',
    sizeBytes: 1280835840,
    modelUrl: `${HF}/unsloth/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-Q4_K_M.gguf?download=true`,
    modelFilename: 'Qwen3.5-2B-Q4_K_M.gguf',
    hasVision: false,
    recommendedSettings: {
      ...QWEN_SETTINGS,
      maxTokens: 3072,
      contextSize: 8192,
      nBatch: 512,
      nThreads: 4,
    },
    systemPrompt: getSystemPrompt('qwen35-2b'),
    features: ['reasoning', 'multilingual', 'code', 'thinking', 'tools', 'agentic'],
    stopSequences: STOP_QWEN,
    draftModelId: 'qwen35-0.8b',
  },
  {
    id: 'qwen35-4b',
    thinkingSettings: QWEN_THINKING,
    toolFormat: 'native',
    name: 'Qwen3.5 (4B)',
    description: 'High-end multimodal model. See and discuss images, deep reasoning, and broad multilingual knowledge on newer devices.',
    size: '2.74 GB',
    sizeBytes: 2740937888,
    modelUrl: `${HF}/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf?download=true`,
    modelFilename: 'Qwen3.5-4B-Q4_K_M.gguf',
    hasVision: true,
    mmprojUrl: `${HF}/unsloth/Qwen3.5-4B-GGUF/resolve/main/mmproj-BF16.gguf?download=true`,
    mmprojFilename: 'Qwen3.5-4B-mmproj-BF16.gguf',
    mmprojSizeBytes: 675569344,
    recommendedSettings: {
      ...QWEN_SETTINGS,
      maxTokens: 2048,
      nBatch: 384,
      nGpuLayers: 48,
    },
    systemPrompt: getSystemPrompt('qwen35-4b'),
    features: ['vision', 'reasoning', 'multilingual', 'code', 'thinking', 'tools', 'agentic'],
    stopSequences: STOP_QWEN,
    draftModelId: 'qwen35-0.8b',
  },
  // Gemma 4 (April 2026, Apache 2.0): system role, native tool calls and a
  // thinking toggle in its template (unlike Gemma 3).
  {
    id: 'gemma4-e2b',
    toolFormat: 'native',
    name: 'Gemma 4 (E2B)',
    description: 'Google\'s latest small model. Sees images, uses tools, and speaks 140+ languages.',
    size: '3.11 GB',
    sizeBytes: 3106738272,
    modelUrl: `${HF}/unsloth/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q4_K_M.gguf?download=true`,
    modelFilename: 'gemma-4-E2B-it-Q4_K_M.gguf',
    hasVision: true,
    mmprojUrl: `${HF}/unsloth/gemma-4-E2B-it-GGUF/resolve/main/mmproj-F16.gguf?download=true`,
    mmprojFilename: 'gemma-4-E2B-it-mmproj-F16.gguf',
    mmprojSizeBytes: 985654080,
    recommendedSettings: {
      ...BASE_SETTINGS,
      // Google's recommended Gemma sampling
      temperature: 1.0,
      topK: 64,
      topP: 0.95,
      minP: 0,
      nBatch: 384,
      nGpuLayers: 48,
    },
    systemPrompt: getSystemPrompt('gemma4-e2b'),
    features: ['vision', 'multilingual', 'code', 'tools', 'thinking'],
    stopSequences: ['<turn|>'],
  },
  {
    id: 'gemma3-4b',
    toolFormat: 'text',
    name: 'Gemma 3 (4B)',
    description: 'Google multilingual all-rounder with vision. Strong quality across 140+ languages.',
    size: '2.49 GB',
    sizeBytes: 2489894016,
    modelUrl: `${HF}/unsloth/gemma-3-4b-it-GGUF/resolve/main/gemma-3-4b-it-Q4_K_M.gguf?download=true`,
    modelFilename: 'gemma-3-4b-it-Q4_K_M.gguf',
    hasVision: true,
    mmprojUrl: `${HF}/unsloth/gemma-3-4b-it-GGUF/resolve/main/mmproj-F16.gguf?download=true`,
    mmprojFilename: 'gemma-3-4b-it-mmproj-F16.gguf',
    mmprojSizeBytes: 851251328,
    recommendedSettings: {
      ...BASE_SETTINGS,
      // Google's recommended sampling for Gemma 3
      temperature: 1.0,
      topK: 64,
      topP: 0.95,
      minP: 0,
      nBatch: 384,
      nGpuLayers: 48,
    },
    systemPrompt: getSystemPrompt('gemma3-4b'),
    features: ['vision', 'multilingual', 'code', 'tools'],
    stopSequences: ['<end_of_turn>'],
  },
  {
    id: 'gemma3-1b',
    toolFormat: 'none',
    name: 'Gemma 3 (1B)',
    description: 'Tiny, fast Google model for quick answers on any device.',
    size: '0.81 GB',
    sizeBytes: 806058272,
    modelUrl: `${HF}/unsloth/gemma-3-1b-it-GGUF/resolve/main/gemma-3-1b-it-Q4_K_M.gguf?download=true`,
    modelFilename: 'gemma-3-1b-it-Q4_K_M.gguf',
    hasVision: false,
    recommendedSettings: {
      ...BASE_SETTINGS,
      temperature: 1.0,
      topK: 64,
      topP: 0.95,
      minP: 0,
      contextSize: 4096,
      nBatch: 384,
    },
    systemPrompt: getSystemPrompt('gemma3-1b'),
    features: ['multilingual'],
    stopSequences: ['<end_of_turn>'],
  },
  {
    id: 'phi4-mini',
    toolFormat: 'none',
    name: 'Phi-4 Mini (3.8B)',
    description: 'Microsoft compact reasoning specialist. Excellent at math, logic, and structured answers.',
    size: '2.49 GB',
    sizeBytes: 2491874272,
    modelUrl: `${HF}/unsloth/Phi-4-mini-instruct-GGUF/resolve/main/Phi-4-mini-instruct-Q4_K_M.gguf?download=true`,
    modelFilename: 'Phi-4-mini-instruct-Q4_K_M.gguf',
    hasVision: false,
    recommendedSettings: {
      ...BASE_SETTINGS,
      temperature: 0.3,
      nBatch: 384,
      nGpuLayers: 48,
    },
    systemPrompt: getSystemPrompt('phi4-mini'),
    features: ['reasoning', 'code', 'multilingual'],
    stopSequences: ['<|end|>', '<|endoftext|>'],
  },
  {
    id: 'llama32-3b',
    toolFormat: 'native',
    name: 'Llama 3.2 (3B)',
    description: 'Meta dependable generalist for balanced chat, writing, and summarisation.',
    size: '2.02 GB',
    sizeBytes: 2019377600,
    modelUrl: `${HF}/unsloth/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf?download=true`,
    modelFilename: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf',
    hasVision: false,
    recommendedSettings: {
      ...BASE_SETTINGS,
      temperature: 0.6,
      topP: 0.9,
      nBatch: 384,
      nGpuLayers: 48,
    },
    systemPrompt: getSystemPrompt('llama32-3b'),
    features: ['multilingual', 'code', 'tools'],
    stopSequences: ['<|eot_id|>', '<|end_of_text|>'],
  },
];

// Index for O(1) lookups by ID
const MODEL_MAP = new Map(AVAILABLE_MODELS.map(m => [m.id, m]));

export function getModelById(id: string): ModelConfig | undefined {
  return MODEL_MAP.get(id);
}

export async function getAllModels(): Promise<ModelConfig[]> {
  const customModels = await customModelService.getModels();
  return [...AVAILABLE_MODELS, ...customModels as ModelConfig[]];
}

export function getDefaultModel(): ModelConfig {
  return MODEL_MAP.get(DEFAULT_MODEL_ID) || AVAILABLE_MODELS[0];
}
