/**
 * Local (in-browser) model catalog. Same GGUF files and vendor sampling as
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
  supportsThinking: boolean;
  /** Rough device memory the model needs to run comfortably. */
  minMemoryGB: number;
}

const HF = 'https://huggingface.co';

const QWEN: Sampling = {
  temperature: 0.7, top_p: 0.8, top_k: 20, min_p: 0, penalty_present: 1.5, penalty_last_n: 256,
};
const QWEN_THINKING: Partial<Sampling> = { temperature: 1.0, top_p: 0.95, top_k: 20, min_p: 0 };

export const LOCAL_MODELS: LocalModel[] = [
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
    sampling: QWEN,
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
    sampling: QWEN,
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

export const DEFAULT_LOCAL_MODEL_ID = 'qwen35-0.8b';

export function getLocalModel(id: string): LocalModel | undefined {
  return LOCAL_MODELS.find(model => model.id === id);
}

export function modelSizeBytes(model: LocalModel): number {
  return model.files.reduce((sum, file) => sum + file.sizeBytes, 0);
}
