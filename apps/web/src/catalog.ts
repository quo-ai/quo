import { hasNativeEngine } from './native';
import { getCustomModel, getCustomModels } from './customModels';

/**
 * Local model catalogs: the browser's (below), and the desktop app's larger
 * one for its native engine (further down).
 *
 * Browser catalog. Same GGUF files and vendor sampling as
 * the mobile catalog (apps/mobile/constants/models.ts); sizes are exact byte counts and
 * are what downloads are validated against.
 *
 * wllama reads files under 2 GiB as-is. Bigger models (Qwen3.5 4B, Gemma 4
 * E2B) need to be split with llama-gguf-split and hosted as parts before
 * they can be listed here.
 */

export interface ModelFile {
  url: string;
  /** Name inside the model's storage folder. */
  name: string;
  sizeBytes: number;
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
}

const HF = 'https://huggingface.co';

const QWEN: Sampling = {
  temperature: 0.7, top_p: 0.8, top_k: 20, min_p: 0, penalty_present: 1.5, penalty_last_n: 256,
};
const QWEN_THINKING: Partial<Sampling> = { temperature: 1.0, top_p: 0.95, top_k: 20, min_p: 0, penalty_present: 1.5 };
// Qwen's own advice for the two smallest (0.8B, 2B; only the browser build still has them), without thinking, for text: a
// freer set with a strong presence penalty (model cards, checked 19 Oct 2026).
const QWEN_SMALL: Sampling = { temperature: 1.0, top_p: 1.0, top_k: 20, min_p: 0, penalty_present: 2.0, penalty_last_n: 256 };
// What one token of window costs in memory, from each architecture (only full-attention layers keep a cache in Qwen3.5).
const KV = { qwenMid: 32_768, qwenLarge: 65_536, gemmaE2B: 8_192, llama3b: 114_688, phi4mini: 131_072 };

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
];

// ---------- Desktop (native engine) ----------
// Same GGUF files as the phone apps' catalog (apps/mobile/constants/models.ts),
// plus larger Qwen3.5 sizes. Files are stored as model.gguf (+ mmproj.gguf for
// vision) in the app's models folder. No 2 GiB limit and a longer context.

// What the models are tuned for is far more (128K to 262K tokens); these are what fits a typical computer, and tuning.ts holds the
// window back further where memory is short. Qwen3.5 and Gemma 4 keep a small cache per token, so they get a longer window.
const NATIVE_LIMITS = { contextSize: 16384, maxTokens: 4096 };
const LONG_WINDOW = 32768;
const GEMMA: Sampling = { temperature: 1.0, top_p: 0.95, top_k: 64, min_p: 0 };
const LLAMA: Sampling = { temperature: 0.6, top_p: 0.9, top_k: 40, min_p: 0.05 };
const PHI: Sampling = { temperature: 0.3, top_p: 0.95, top_k: 40, min_p: 0.05 };

function nativeModel(
  id: string,
  name: string,
  description: string,
  repo: string,
  file: { name: string; bytes: number },
  vision: { name?: string; bytes: number } | null,
  minMemoryGB: number,
  extra: Partial<LocalModel>,
): LocalModel {
  const files: ModelFile[] = [{ url: `${HF}/${repo}/resolve/main/${file.name}`, name: 'model.gguf', sizeBytes: file.bytes }];
  if (vision) files.push({ url: `${HF}/${repo}/resolve/main/${vision.name ?? 'mmproj-F16.gguf'}`, name: 'mmproj.gguf', sizeBytes: vision.bytes });
  return { id, name, description, files, ...NATIVE_LIMITS, sampling: QWEN, supportsThinking: false, minMemoryGB, native: true, vision: Boolean(vision), ...extra };
}

const qwen = (id: string, size: string, description: string, file: number, vision: number, minMemoryGB: number, kv: number, agent?: LocalModel['agent']) =>
  nativeModel(id, `Qwen3.5 ${size}`, description, `unsloth/Qwen3.5-${size}-GGUF`, { name: `Qwen3.5-${size}-Q4_K_M.gguf`, bytes: file }, { bytes: vision }, minMemoryGB, {
    contextSize: LONG_WINDOW,
    kvBytesPerToken: kv,
    thinkingSampling: QWEN_THINKING,
    supportsThinking: true,
    ...(agent ? { agent } : {}),
  });

export const DESKTOP_MODELS: LocalModel[] = [
  qwen('qwen35-4b', '4B', 'Strong all-rounder with careful reasoning. Reads images. Best on a computer with a graphics card.', 2740937888, 672423616, 8, KV.qwenMid, 'limited'),
  qwen('qwen35-9b', '9B', 'A big step up in quality and reasoning. Reads images. Wants a graphics card with 8 GB or more, or 16 GB of memory.', 5680522464, 918166080, 12, KV.qwenMid, 'good'),
  qwen('qwen35-27b', '27B', 'The most capable model here. Reads images. For computers with 32 GB or more of memory, or a high-end graphics card.', 16740812704, 927607040, 32, KV.qwenLarge, 'good'),
  nativeModel('gemma4-e2b', 'Gemma 4 E2B', 'Google’s small multilingual model. Reads images and speaks 140+ languages.', 'unsloth/gemma-4-E2B-it-GGUF',
    { name: 'gemma-4-E2B-it-Q4_K_M.gguf', bytes: 3106738272 }, { bytes: 985654080 }, 8, { sampling: GEMMA, contextSize: LONG_WINDOW, kvBytesPerToken: KV.gemmaE2B }),
  nativeModel('llama32-3b', 'Llama 3.2 3B', 'Dependable all-rounder for writing and summarising.', 'unsloth/Llama-3.2-3B-Instruct-GGUF',
    { name: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf', bytes: 2019377600 }, null, 8, { sampling: LLAMA, kvBytesPerToken: KV.llama3b }),
  nativeModel('phi4-mini', 'Phi-4 Mini', 'Microsoft’s compact reasoning model. Strong at maths, logic and structured answers.', 'unsloth/Phi-4-mini-instruct-GGUF',
    { name: 'Phi-4-mini-instruct-Q4_K_M.gguf', bytes: 2491874272 }, null, 8, { sampling: PHI, kvBytesPerToken: KV.phi4mini }),
];

/** The models offered here: the desktop app's native catalog, or the browser's. */
export const LOCAL_MODELS: LocalModel[] = hasNativeEngine() ? DESKTOP_MODELS : WEB_MODELS;

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
];

/** The catalog plus any models the user added (desktop app). */
export function allLocalModels(): LocalModel[] {
  return [...LOCAL_MODELS, ...getCustomModels()];
}

export function getLocalModel(id: string): LocalModel | undefined {
  return LOCAL_MODELS.find(model => model.id === id) ?? getCustomModel(id);
}

export function modelSizeBytes(model: LocalModel): number {
  return model.files.reduce((sum, file) => sum + file.sizeBytes, 0);
}
