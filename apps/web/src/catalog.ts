import { hasNativeEngine } from './native';
import { getCustomModel, getCustomModels } from './customModels';
import { runsMainBuild } from './engine/wasm';
import { getHfModels } from './models/hfStore';

/**
 * Local model catalogs: the browser's (below), and the desktop app's larger
 * one for its native engine (further down).
 *
 * Browser catalog. Same GGUF files and vendor sampling as
 * the mobile catalog (apps/mobile/constants/models.ts); sizes are exact byte counts and
 * are what downloads are validated against.
 *
 * A file of 2 GiB or more loads only in wllama's main build (current Chrome,
 * Edge and Firefox; engine/wasm.ts): elsewhere such a model isn't offered.
 */

export interface ModelFile {
  url: string;
  /** Name inside the model's storage folder. */
  name: string;
  sizeBytes: number;
  /** Sizes an earlier edition of this file had: someone who has one already has the model, and it keeps working. */
  altSizes?: number[];
  /** Downloaded with the model, but the model counts as installed without it (a drafter that only makes it faster). */
  optional?: boolean;
}

export interface Sampling {
  temperature: number;
  top_p: number;
  top_k: number;
  min_p: number;
  penalty_present?: number;
  penalty_last_n?: number;
}

export interface LocalModel {
  id: string;
  name: string;
  description: string;
  files: ModelFile[];
  contextSize: number;
  maxTokens: number;
  sampling: Sampling;
  /** Applied over `sampling` when thinking is on. */
  thinkingSampling?: Partial<Sampling>;
  /** Memory one token of the context window takes (16-bit cache, from the model's architecture): used to hold the window back on a small computer. */
  kvBytesPerToken?: number;
  supportsThinking: boolean;
  /** Rough device memory the model needs to run comfortably. */
  minMemoryGB: number;
  /** Can read images: its files include a vision projector (mmproj.gguf). */
  vision?: boolean;
  /** Needs the desktop app's native engine (too big, or needs vision, for the browser). */
  native?: boolean;
  /** A model the user added from their own computer (desktop app). */
  custom?: boolean;
  /**
   * How well it is expected to work as a coding agent (Code mode on this computer): 'good' is recommended and turned on
   * by default; 'limited' handles small jobs. Models without it are too small, and Code mode is opt-in for them.
   */
  agent?: 'good' | 'limited';
  /** Where an added model came from (desktop app: models/hfStore.ts). Catalog models have none. */
  source?: { kind: 'huggingface'; repo: string };
}

const HF = 'https://huggingface.co';

const QWEN: Sampling = {
  temperature: 0.7, top_p: 0.8, top_k: 20, min_p: 0, penalty_present: 1.5, penalty_last_n: 256,
};
const QWEN_THINKING: Partial<Sampling> = { temperature: 1.0, top_p: 0.95, top_k: 20, min_p: 0, penalty_present: 1.5 };
// Qwen3.8 keeps Qwen3.5's set without thinking, and drops the presence penalty with it (model card, checked 20 Oct 2026).
const QWEN38_THINKING: Partial<Sampling> = { temperature: 1.0, top_p: 0.95, top_k: 20, min_p: 0, penalty_present: 0 };
// Qwen's own advice for the two smallest (0.8B, 2B; only the browser build still has them), without thinking, for text: a
// freer set with a strong presence penalty (model cards, checked 19 Oct 2026).
const QWEN_SMALL: Sampling = { temperature: 1.0, top_p: 1.0, top_k: 20, min_p: 0, penalty_present: 2.0, penalty_last_n: 256 };
// What one token of window costs in memory, from each architecture (only full-attention layers keep a cache in Qwen3.5; the
// MTP editions have one more, the prediction head's).
const KV = { qwenMid: 36_864, qwenLarge: 69_632, gemmaE2B: 8_192, gemma12b: 16_384, gemma26b: 20_480, llama3b: 114_688, phi4mini: 131_072 };
// Google's advice for Gemma 4, the same with or without thinking (thinking is the chat template's enable_thinking).
const GEMMA: Sampling = { temperature: 1.0, top_p: 0.95, top_k: 64, min_p: 0 };

const WEB_MODELS: LocalModel[] = [
  {
    id: 'qwen35-0.8b',
    name: 'Qwen3.5 0.8B',
    description: 'Fast and light. A quick first download that runs on almost any computer.',
    files: [{
      url: `${HF}/unsloth/Qwen3.5-0.8B-GGUF/resolve/main/Qwen3.5-0.8B-Q4_K_M.gguf`,
      name: 'model.gguf',
      sizeBytes: 532517120,
    }],
    contextSize: 8192,
    maxTokens: 2048,
    sampling: QWEN_SMALL,
    thinkingSampling: QWEN_THINKING,
    supportsThinking: true,
    minMemoryGB: 4,
  },
  {
    id: 'qwen35-2b',
    name: 'Qwen3.5 2B',
    description: 'Balanced. Noticeably smarter, still quick on most laptops.',
    files: [{
      url: `${HF}/unsloth/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-Q4_K_M.gguf`,
      name: 'model.gguf',
      sizeBytes: 1280835840,
    }],
    contextSize: 8192,
    maxTokens: 3072,
    sampling: QWEN_SMALL,
    thinkingSampling: QWEN_THINKING,
    supportsThinking: true,
    minMemoryGB: 8,
  },
  {
    id: 'llama32-3b',
    name: 'Llama 3.2 3B',
    description: 'Dependable all-rounder for writing and summarising.',
    files: [{
      url: `${HF}/unsloth/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf`,
      name: 'model.gguf',
      sizeBytes: 2019377600,
    }],
    contextSize: 8192,
    maxTokens: 2048,
    sampling: { temperature: 0.6, top_p: 0.9, top_k: 40, min_p: 0.05 },
    supportsThinking: false,
    minMemoryGB: 8,
  },
  {
    // The quantization-aware edition: Google trained it for 4-bit, so it is smaller than the desktop's file and as good.
    id: 'gemma4-e2b',
    name: 'Gemma 4 E2B',
    description: 'Google’s small model, at home in 140+ languages. Best with a graphics card.',
    files: [{
      url: `${HF}/unsloth/gemma-4-E2B-it-qat-GGUF/resolve/main/gemma-4-E2B-it-qat-UD-Q4_K_XL.gguf`,
      name: 'model.gguf',
      sizeBytes: 2620370976,
    }],
    contextSize: 8192,
    maxTokens: 3072,
    sampling: GEMMA,
    kvBytesPerToken: KV.gemmaE2B,
    supportsThinking: true,
    minMemoryGB: 8,
  },
];

/** The browser's models that load here: a file of 2 GiB or more needs wllama's main build. */
const loadsInThisBrowser = (model: LocalModel) => runsMainBuild() || model.files.every(file => file.sizeBytes < 2 ** 31);

// ---------- Desktop (native engine) ----------
// Same GGUF files as the phone apps' catalog (apps/mobile/constants/models.ts),
// plus larger Qwen3.5 sizes. Files are stored as model.gguf (+ mmproj.gguf for
// vision) in the app's models folder. No 2 GiB limit and a longer context.

// What the models are tuned for is far more (128K to 262K tokens); these are what fits a typical computer, and tuning.ts holds the
// window back further where memory is short. Qwen3.5 and Gemma 4 keep a small cache per token, so they get a longer window.
const NATIVE_LIMITS = { contextSize: 16384, maxTokens: 4096 };
const LONG_WINDOW = 32768;
const LLAMA: Sampling = { temperature: 0.6, top_p: 0.9, top_k: 40, min_p: 0.05 };
const PHI: Sampling = { temperature: 0.3, top_p: 0.95, top_k: 40, min_p: 0.05 };

function nativeModel(
  id: string,
  name: string,
  description: string,
  repo: string,
  file: { name: string; bytes: number; altSizes?: number[] },
  vision: { name?: string; bytes: number; altSizes?: number[] } | null,
  minMemoryGB: number,
  extra: Partial<LocalModel>,
  draft?: { name: string; bytes: number },
): LocalModel {
  const files: ModelFile[] = [{ url: `${HF}/${repo}/resolve/main/${file.name}`, name: 'model.gguf', sizeBytes: file.bytes, ...(file.altSizes ? { altSizes: file.altSizes } : {}) }];
  if (vision) files.push({ url: `${HF}/${repo}/resolve/main/${vision.name ?? 'mmproj-F16.gguf'}`, name: 'mmproj.gguf', sizeBytes: vision.bytes, ...(vision.altSizes ? { altSizes: vision.altSizes } : {}) });
  // Gemma 4's drafter: the engine drafts with it (several tokens a step, the same text); the model runs without it.
  if (draft) files.push({ url: `${HF}/${repo}/resolve/main/${draft.name}`, name: 'draft.gguf', sizeBytes: draft.bytes, optional: true });
  return { id, name, description, files, ...NATIVE_LIMITS, sampling: QWEN, supportsThinking: false, minMemoryGB, native: true, vision: Boolean(vision), ...extra };
}

// The Qwen3.5 models come from Unsloth's "-MTP" editions: the same models with the multi-token-prediction head kept, which
// the engine uses to write several tokens per step (about twice as fast on code edits, the same text; verified on the 4B).
// The files are a little larger. `older` are the sizes of the plain editions Quo used to offer: someone who downloaded one
// still has a working model, which runs as it always did (the engine reads from the file whether it has the head).
const qwen = (id: string, size: string, description: string, file: number, vision: number, minMemoryGB: number, kv: number, older: { model: number; projector: number }, agent?: LocalModel['agent']) =>
  nativeModel(id, `Qwen3.5 ${size}`, description, `unsloth/Qwen3.5-${size}-MTP-GGUF`, { name: `Qwen3.5-${size}-Q4_K_M.gguf`, bytes: file, altSizes: [older.model] }, { bytes: vision, altSizes: [older.projector] }, minMemoryGB, {
    contextSize: LONG_WINDOW,
    kvBytesPerToken: kv,
    thinkingSampling: QWEN_THINKING,
    supportsThinking: true,
    ...(agent ? { agent } : {}),
  });

export const DESKTOP_MODELS: LocalModel[] = [
  qwen('qwen35-4b', '4B', 'Strong all-rounder with careful reasoning. Reads images. Best on a computer with a graphics card.', 2834975040, 672423488, 8, KV.qwenMid, { model: 2740937888, projector: 672423616 }, 'limited'),
  qwen('qwen35-9b', '9B', 'A big step up in quality and reasoning. Reads images. Wants a graphics card with 8 GB or more, or 16 GB of memory.', 5868826976, 918165984, 12, KV.qwenMid, { model: 5680522464, projector: 918166080 }, 'good'),
  // Qwen3.8 27B replaced Qwen3.5 27B: the same architecture, newer training. Unsloth's file keeps the prediction head (as the
  // MTP editions above do), so the window costs the same and the engine writes several tokens per step.
  nativeModel('qwen38-27b', 'Qwen3.8 27B', 'The most capable model here. Reads images. For computers with 32 GB or more of memory, or a high-end graphics card.', 'unsloth/Qwen3.8-27B-GGUF',
    { name: 'Qwen3.8-27B-UD-Q4_K_M.gguf', bytes: 16464440224 }, { bytes: 927607488 }, 32, { contextSize: LONG_WINDOW, kvBytesPerToken: KV.qwenLarge, thinkingSampling: QWEN38_THINKING, supportsThinking: true, agent: 'good' }),
  // Gemma 4 in the quantization-aware editions (trained for 4-bit: smaller, as good), each with its drafter. The E2B was the
  // plain Q4_K_M file before: someone who has it keeps it (altSizes).
  nativeModel('gemma4-e2b', 'Gemma 4 E2B', 'Google’s small multilingual model. Reads images and speaks 140+ languages.', 'unsloth/gemma-4-E2B-it-qat-GGUF',
    { name: 'gemma-4-E2B-it-qat-UD-Q4_K_XL.gguf', bytes: 2620370976, altSizes: [3106738272] }, { bytes: 985654080 }, 8, { sampling: GEMMA, contextSize: LONG_WINDOW, kvBytesPerToken: KV.gemmaE2B, supportsThinking: true },
    { name: 'mtp-gemma-4-E2B-it.gguf', bytes: 59235648 }),
  nativeModel('gemma4-12b', 'Gemma 4 12B', 'Google’s mid-size model: clear writing in 140+ languages. Reads images. Wants a graphics card with 8 GB or more, or 16 GB of memory.', 'unsloth/gemma-4-12B-it-qat-GGUF',
    { name: 'gemma-4-12B-it-qat-UD-Q4_K_XL.gguf', bytes: 6716356800 }, { bytes: 175115840 }, 12, { sampling: GEMMA, contextSize: LONG_WINDOW, kvBytesPerToken: KV.gemma12b, supportsThinking: true, agent: 'limited' },
    { name: 'mtp-gemma-4-12B-it.gguf', bytes: 253708800 }),
  nativeModel('gemma4-26b-a4b', 'Gemma 4 26B A4B', 'Google’s larger model, quick for its size: it uses only part of itself for each word. Reads images. For computers with 24 GB or more of memory.', 'unsloth/gemma-4-26B-A4B-it-qat-GGUF',
    { name: 'gemma-4-26B-A4B-it-qat-UD-Q4_K_XL.gguf', bytes: 14249047104 }, { bytes: 1193058784 }, 24, { sampling: GEMMA, contextSize: LONG_WINDOW, kvBytesPerToken: KV.gemma26b, supportsThinking: true, agent: 'limited' },
    { name: 'mtp-gemma-4-26B-A4B-it.gguf', bytes: 251939328 }),
  nativeModel('llama32-3b', 'Llama 3.2 3B', 'Dependable all-rounder for writing and summarising.', 'unsloth/Llama-3.2-3B-Instruct-GGUF',
    { name: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf', bytes: 2019377600 }, null, 8, { sampling: LLAMA, kvBytesPerToken: KV.llama3b }),
  nativeModel('phi4-mini', 'Phi-4 Mini', 'Microsoft’s compact reasoning model. Strong at maths, logic and structured answers.', 'unsloth/Phi-4-mini-instruct-GGUF',
    { name: 'Phi-4-mini-instruct-Q4_K_M.gguf', bytes: 2491874272 }, null, 8, { sampling: PHI, kvBytesPerToken: KV.phi4mini }),
];

/** The models offered here: the desktop app's native catalog, or the browser's. */
export const LOCAL_MODELS: LocalModel[] = hasNativeEngine() ? DESKTOP_MODELS : WEB_MODELS.filter(loadsInThisBrowser);

// The desktop app starts people on Qwen3.5 4B: the two smaller Qwens were taken out of it (too weak: confident wrong answers).
export const DEFAULT_NATIVE_MODEL_ID = 'qwen35-4b';
export const DEFAULT_LOCAL_MODEL_ID = hasNativeEngine() ? DEFAULT_NATIVE_MODEL_ID : 'qwen35-0.8b';

/**
 * Models the desktop app used to offer and no longer does. Someone who downloaded one still has its files: the storage
 * settings find them by what they were (id and files) and offer to remove them.
 */
export const RETIRED_MODELS: { id: string; name: string; files: { name: string; sizeBytes: number }[] }[] = [
  { id: 'qwen35-0.8b', name: 'Qwen3.5 0.8B', files: [{ name: 'model.gguf', sizeBytes: 532517120 }, { name: 'mmproj.gguf', sizeBytes: 204987232 }] },
  { id: 'qwen35-2b', name: 'Qwen3.5 2B', files: [{ name: 'model.gguf', sizeBytes: 1280835840 }, { name: 'mmproj.gguf', sizeBytes: 668227264 }] },
  { id: 'qwen35-27b', name: 'Qwen3.5 27B', files: [{ name: 'model.gguf', sizeBytes: 17106773056 }, { name: 'mmproj.gguf', sizeBytes: 927607392 }] },
];

/** Models the person added from Hugging Face; desktop app only (they need its engine). */
const addedModels = (): LocalModel[] => (hasNativeEngine() ? getHfModels() : []);

/** The catalog plus any models the user added (desktop app). */
export function allLocalModels(): LocalModel[] {
  return [...LOCAL_MODELS, ...addedModels(), ...getCustomModels()];
}

export function getLocalModel(id: string): LocalModel | undefined {
  return LOCAL_MODELS.find(model => model.id === id) ?? addedModels().find(model => model.id === id) ?? getCustomModel(id);
}

export function modelSizeBytes(model: LocalModel): number {
  return model.files.reduce((sum, file) => sum + file.sizeBytes, 0);
}
