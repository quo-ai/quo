import { getInfoAsync, readAsStringAsync } from 'expo-file-system/legacy';
import { MODELS_DIR } from '../fileDownload';

/**
 * Model file path resolution helpers. All model weights (and mmproj files)
 * live under MODELS_DIR (`<documentDirectory>models/`).
 */

export function getModelPath(model: { modelFilename: string }): string {
  return `${MODELS_DIR}${model.modelFilename}`;
}

export function getModelTempPath(model: { modelFilename: string }): string {
  return `${MODELS_DIR}${model.modelFilename}.tmp`;
}

export function getMmprojPath(model: { mmprojFilename?: string }): string {
  return model.mmprojFilename ? `${MODELS_DIR}${model.mmprojFilename}` : '';
}

/**
 * Single validity policy for mmproj files, shared by the download path and
 * checkMmprojExists so the two can never disagree about the same file.
 * 90% of the catalog size catches truncation while tolerating modest
 * upstream/catalog drift; with no catalog size, reject only obviously
 * broken files (empty bodies, HTML error pages).
 */
export function getMmprojMinValidBytes(model: { mmprojSizeBytes?: number }): number {
  return model.mmprojSizeBytes ? Math.floor(model.mmprojSizeBytes * 0.9) : 1024 * 1024;
}

/** A model file must be at least this fraction of its catalog size. */
export const MODEL_MIN_VALID_FRACTION = 0.95;
// Floor for models with no known size (custom models): anything smaller is
// an error page or an empty body, not weights.
const UNKNOWN_SIZE_MIN_BYTES = 1024 * 1024;
// "GGUF" — the first four bytes of every GGUF file, base64-encoded.
const GGUF_MAGIC_BASE64 = 'R0dVRg==';

/** Minimum byte size at which a model file counts as complete. */
export function getModelMinValidBytes(model: { sizeBytes: number }): number {
  // The floor also applies to known sizes: a custom model's size comes from
  // the server's HEAD response, which for a bad URL is an HTML page's length.
  return Math.max(UNKNOWN_SIZE_MIN_BYTES, Math.floor(model.sizeBytes * MODEL_MIN_VALID_FRACTION));
}

async function hasGgufMagic(path: string): Promise<boolean> {
  try {
    const head = await readAsStringAsync(path, { encoding: 'base64', position: 0, length: 4 });
    return head === GGUF_MAGIC_BASE64;
  } catch {
    return false;
  }
}

/**
 * The one validity rule for a model file on disk, used by every path that
 * decides a model is present: modelFileExists, download finalization, the
 * "already downloaded" shortcut, draft-model lookup and the bundled-starter
 * copy. Truncated GGUFs pass existence checks and crash at initLlama, so a
 * file counts only when it is >= 95% of the catalog size (and above a small
 * floor) and starts with the GGUF magic bytes (a 4-byte read; rejects
 * captive-portal HTML and error bodies whose length matched the expectation). `path` defaults to the model's
 * final location (pass the temp path to validate before promoting).
 */
export async function isModelFileValid(
  model: { modelFilename: string; sizeBytes: number },
  path: string = getModelPath(model),
): Promise<boolean> {
  try {
    const info = await getInfoAsync(path);
    if (!info.exists || !('size' in info) || info.size < getModelMinValidBytes(model)) {
      return false;
    }
    return await hasGgufMagic(path);
  } catch {
    return false;
  }
}
