import { Platform } from 'react-native';
import { ModelConfig, getModelById, DEFAULT_MODEL_ID } from '@/constants/models';
import { getBundledStarterSource } from '../bundledModel';
import { getModelPath, isModelFileValid } from './paths';

/**
 * initLlama parameter assembly, including the speculative-decoding
 * (draft-model) wiring.
 */

/**
 * Resolve the draft-model source for speculative decoding: draft with a
 * smaller same-family model when the user enabled it and the draft weights
 * are available — from disk, or straight from the asset pack when the
 * starter is the draft.
 */
export async function resolveDraftModel(
  model: ModelConfig,
  currentModelId: string,
  speculativeEnabled: boolean,
  modelFileExists: (model: ModelConfig) => Promise<boolean>,
): Promise<{ draftModelPath: string | null; draftIsAsset: boolean; isMtp: boolean }> {
  let draftModelPath: string | null = null;
  let draftIsAsset = false;
  // An MTP draft head (published with the model) beats a separate small
  // draft model: it shares the target's state and is ~100MB.
  if (speculativeEnabled && model.mtpDraft) {
    const mtp = { modelFilename: model.mtpDraft.filename, sizeBytes: model.mtpDraft.sizeBytes };
    if (await isModelFileValid(mtp)) {
      return { draftModelPath: getModelPath(mtp), draftIsAsset: false, isMtp: true };
    }
  }
  if (speculativeEnabled && model.draftModelId) {
    const draftModel = getModelById(model.draftModelId);
    if (draftModel && draftModel.id !== currentModelId) {
      if (await modelFileExists(draftModel)) {
        draftModelPath = getModelPath(draftModel);
      } else if (draftModel.id === DEFAULT_MODEL_ID) {
        const source = await getBundledStarterSource();
        draftModelPath = source?.path ?? null;
        draftIsAsset = source?.isAsset ?? false;
      }
    }
  }
  return { draftModelPath, draftIsAsset, isMtp: false };
}

/**
 * Assemble initLlama params for the given model. `modelSource` is either
 * a file path or an AssetManager-relative path (with isModelAsset true).
 */
export async function buildInitParams(
  modelSource: string,
  isModelAsset: boolean,
  model: ModelConfig,
  currentModelId: string,
  speculativeEnabled: boolean,
  modelFileExists: (model: ModelConfig) => Promise<boolean>,
) {
  // Use conservative mobile defaults unless a model explicitly opts in to
  // more aggressive settings.
  const defaultBatch = model.hasVision ? 384 : 512;
  const defaultThreads = 4;
  // Android runs CPU-only in this app (OpenCL/Hexagon disabled), so its layer
  // count is effectively a no-op ceiling. iOS engages Metal with unified
  // memory, so offload everything by default. Per-model
  // recommendedSettings.nGpuLayers still overrides this below.
  const defaultGpuLayers = Platform.OS === 'ios' ? 99 : model.hasVision ? 48 : 60;
  const contextSize = model.recommendedSettings.contextSize || 8192;

  const modelSettings = model.recommendedSettings;
  const nBatch = modelSettings.nBatch ?? defaultBatch;
  const nThreads = modelSettings.nThreads ?? defaultThreads;
  const nGpuLayers = modelSettings.nGpuLayers ?? defaultGpuLayers;
  const flashAttnType = modelSettings.flashAttn ?? 'auto';
  const cacheTypeK = modelSettings.cacheTypeK ?? 'f16';
  const cacheTypeV = modelSettings.cacheTypeV ?? 'f16';

  const { draftModelPath, draftIsAsset, isMtp } = await resolveDraftModel(
    model,
    currentModelId,
    speculativeEnabled,
    modelFileExists,
  );

  return {
    model: modelSource,
    ...(isModelAsset ? { is_model_asset: true } : {}),
    ...(draftModelPath
      ? {
          model_draft: draftModelPath,
          ...(draftIsAsset ? { is_model_draft_asset: true } : {}),
          ...(isMtp ? { speculative: 'draft-mtp' as const } : {}),
        }
      : {}),
    n_ctx: contextSize,
    n_batch: nBatch,
    n_threads: nThreads,
    use_mmap: true,
    use_mlock: false,
    n_gpu_layers: nGpuLayers,
    flash_attn_type: flashAttnType as 'auto' | 'on' | 'off',
    cache_type_k: cacheTypeK,
    cache_type_v: cacheTypeV,
    // Stability-first: we proactively trim history to fit the context
    // window, so we no longer rely on native context shifting.
    ctx_shift: false,
  };
}
