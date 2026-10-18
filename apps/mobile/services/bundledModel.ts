import { Platform } from 'react-native';
import {
  documentDirectory,
  bundleDirectory,
  getInfoAsync,
  makeDirectoryAsync,
  copyAsync,
  moveAsync,
  deleteAsync,
} from 'expo-file-system/legacy';
import { getDefaultModel } from '@/constants/models';
import { analyticsService } from './analyticsService';
import { fileHasValidSize, claimTempPath } from './fileDownload';
import { isModelFileValid } from './llm/paths';
import { AssetPacks, AssetPackStatus, AssetPackErrorCode, type AssetPackState } from '@/modules/asset-packs/src';

// The starter model can ship with the app:
//   Android — a Play Asset Delivery fast-follow pack
//     (android/starter_model_pack). Play downloads it automatically right
//     after install, so the store download stays small and the app opens
//     immediately. Fast-follow packs are stored as plain files, so llama.rn
//     memory-maps the model in place — no copy (deliverStarterPack drives
//     the download UI while it's still arriving). Builds that carry the model
//     as an APK asset instead (install-time packs, or local debug assets from
//     `fetch-starter-model --debug-assets`) are read via AssetManager and
//     copied out once by materializeBundledStarter, since Android llama.rn
//     can't load assets directly.
//   iOS — a plain resource at the app-bundle root
//     (plugins/withIosBundledModel.js); bundle resources are real files, so
//     llama.rn loads it directly via is_model_asset with no copy.
//
// Builds without the bundled model (sideloaded/dev installs, or release
// builds where scripts/fetch-starter-model.js was not run) simply report it
// as missing and the normal download flow takes over.
const BUNDLED_ASSET_DIR = 'bundled-models';
export const STARTER_PACK_NAME = 'starter_model_pack';

function bundledAssetUri(filename: string): string {
  return `asset:///${BUNDLED_ASSET_DIR}/${filename}`;
}

/** Where the bundled starter can be loaded from right now. */
export interface BundledStarterSource {
  /** File URI, or an asset-relative path when `isAsset`. */
  path: string;
  /** Load via llama.rn's is_model_asset (bundle/AssetManager-relative). */
  isAsset: boolean;
}

export async function isBundledStarterAvailable(): Promise<boolean> {
  return (await getBundledStarterSource()) !== null;
}

/** File URI of the starter inside the downloaded fast-follow pack, if any. */
function starterPackFileUri(filename: string): string | null {
  if (Platform.OS !== 'android') return null;
  const assetsPath = AssetPacks?.getPackAssetsPath(STARTER_PACK_NAME);
  return assetsPath ? `file://${assetsPath}/${BUNDLED_ASSET_DIR}/${filename}` : null;
}

/**
 * The bundled starter model's load source, or null when this build/device
 * has no usable bundled copy (yet).
 */
export async function getBundledStarterSource(): Promise<BundledStarterSource | null> {
  const model = getDefaultModel();
  const filename = model.modelFilename;
  try {
    if (Platform.OS === 'android') {
      const packFile = starterPackFileUri(filename);
      if (packFile && (await isModelFileValid(model, packFile))) {
        return { path: packFile, isAsset: false };
      }
      const info = await getInfoAsync(bundledAssetUri(filename));
      return info.exists ? { path: `${BUNDLED_ASSET_DIR}/${filename}`, isAsset: true } : null;
    }
    if (Platform.OS === 'ios' && bundleDirectory) {
      const info = await getInfoAsync(`${bundleDirectory}${filename}`);
      return info.exists ? { path: filename, isAsset: true } : null;
    }
    return null;
  } catch {
    return null;
  }
}

export type StarterPackResult =
  /** The pack is on disk; getBundledStarterSource() now returns it. */
  | 'completed'
  /** This install has no deliverable pack (sideloaded/dev build): use another source. */
  | 'unavailable'
  /** Queued for Wi-Fi: the user declined downloading over mobile data. */
  | 'waiting_for_wifi'
  | 'insufficient_storage'
  | 'failed';

const IN_PROGRESS_STATUSES: number[] = [
  AssetPackStatus.PENDING,
  AssetPackStatus.DOWNLOADING,
  AssetPackStatus.TRANSFERRING,
  AssetPackStatus.WAITING_FOR_WIFI,
  AssetPackStatus.REQUIRES_USER_CONFIRMATION,
];

/** Play knows this pack for this install (false for sideloaded/dev builds). */
function isDeliverable(state: AssetPackState): boolean {
  return state.errorCode === AssetPackErrorCode.NO_ERROR && state.status !== AssetPackStatus.UNKNOWN;
}

/**
 * True when Play is already delivering (or has delivered) the starter pack
 * for this install — first launch should follow that download rather than
 * offering a second one.
 */
export async function isStarterPackOnItsWay(): Promise<boolean> {
  if (!AssetPacks) return false;
  const state = await AssetPacks.getPackState(STARTER_PACK_NAME).catch(() => null);
  return state !== null && isDeliverable(state)
    && (IN_PROGRESS_STATUSES.includes(state.status) || state.status === AssetPackStatus.COMPLETED);
}

/**
 * Make sure the fast-follow starter pack is on disk, reporting progress
 * (0–1) while Play downloads it. Asks Play to show its mobile-data
 * confirmation when the download is held for Wi-Fi.
 */
export async function deliverStarterPack(onProgress: (fraction: number) => void): Promise<StarterPackResult> {
  const packs = AssetPacks;
  if (!packs) return 'unavailable';
  const initial = await packs.getPackState(STARTER_PACK_NAME).catch(() => null);
  if (!initial || !isDeliverable(initial)) return 'unavailable';
  if (initial.status === AssetPackStatus.COMPLETED && starterPackFileUri(getDefaultModel().modelFilename)) {
    return 'completed';
  }

  return new Promise<StarterPackResult>((resolve) => {
    let settled = false;
    let askedForConfirmation = false;
    const finish = (result: StarterPackResult) => {
      if (settled) return;
      settled = true;
      subscription.remove();
      resolve(result);
    };

    const handle = (state: AssetPackState) => {
      if (state.name !== STARTER_PACK_NAME || settled) return;
      switch (state.status) {
        case AssetPackStatus.DOWNLOADING:
          if (state.totalBytes > 0) onProgress(Math.min(state.bytesDownloaded / state.totalBytes, 1) * 0.95);
          break;
        case AssetPackStatus.TRANSFERRING:
          onProgress(0.95 + (state.transferProgress / 100) * 0.05);
          break;
        case AssetPackStatus.COMPLETED:
          onProgress(1);
          finish('completed');
          break;
        case AssetPackStatus.WAITING_FOR_WIFI:
        case AssetPackStatus.REQUIRES_USER_CONFIRMATION:
          if (askedForConfirmation) break;
          askedForConfirmation = true;
          void packs.showConfirmationDialog().then((accepted) => {
            // Accepted: Play resumes and keeps reporting progress.
            if (!accepted) finish('waiting_for_wifi');
          });
          break;
        case AssetPackStatus.FAILED:
          finish(state.errorCode === AssetPackErrorCode.INSUFFICIENT_STORAGE ? 'insufficient_storage' : 'failed');
          break;
        case AssetPackStatus.CANCELED:
          finish('failed');
          break;
      }
    };

    const subscription = packs.addListener('onStateChange', handle);
    // Already downloading (Play started it right after install): just follow
    // along. Otherwise ask Play to fetch it now.
    const request = IN_PROGRESS_STATUSES.includes(initial.status)
      ? packs.getPackState(STARTER_PACK_NAME)
      : packs.fetch(STARTER_PACK_NAME);
    void request.then((state) => {
      if (isDeliverable(state)) {
        handle(state);
      } else {
        finish(state.errorCode === AssetPackErrorCode.INSUFFICIENT_STORAGE ? 'insufficient_storage' : 'failed');
      }
    }, () => finish('failed'));
  });
}

/**
 * Users upgrading from the install-time pack already have a copied-out
 * starter in the models directory; Play still delivers the fast-follow pack
 * after the update, which would store the model twice. Drop the pack then.
 */
export async function removeRedundantStarterPack(): Promise<void> {
  if (!AssetPacks) return;
  const model = getDefaultModel();
  if (!starterPackFileUri(model.modelFilename)) return;
  if (await isModelFileValid(model, `${documentDirectory}models/${model.modelFilename}`)) {
    await AssetPacks.removePack(STARTER_PACK_NAME).catch(() => false);
  }
}

/** Platform-appropriate readable URI of the bundled starter, for copying. */
function bundledSourceUri(filename: string): string | null {
  if (Platform.OS === 'android') return bundledAssetUri(filename);
  if (Platform.OS === 'ios' && bundleDirectory) return `${bundleDirectory}${filename}`;
  return null;
}

/**
 * Copy the bundled starter model out of the asset pack into the models
 * directory so it can be memory-mapped. Idempotent: returns true immediately
 * when the model file already exists. Returns false when this build has no
 * bundled model or the copy fails — callers fall back to the download flow.
 */
export async function materializeBundledStarter(): Promise<boolean> {
  const model = getDefaultModel();
  const assetUri = bundledSourceUri(model.modelFilename);
  if (!assetUri) return false;

  const destDir = `${documentDirectory}models/`;
  const dest = `${destDir}${model.modelFilename}`;
  // Copy to a temp name and rename into place: an app killed mid-copy must
  // never leave a partial file at the final path, where it would pass the
  // existence check and crash initLlama on every launch.
  const tempDest = `${dest}.tmp`;
  const releaseTemp = claimTempPath(tempDest);

  try {
    // One validity rule for both the already-copied short-circuit and the
    // post-copy verification: the source asset's exact size when this build
    // ships the model and the platform reports it, else the shared catalog
    // policy (isModelFileValid). The dest check runs even when the asset is
    // absent — a previously materialized model stays valid in builds
    // without the pack.
    const assetInfo = await getInfoAsync(assetUri);
    const assetBytes = assetInfo.exists && 'size' in assetInfo ? assetInfo.size : 0;
    const isValid = (path: string) =>
      assetBytes > 0 ? fileHasValidSize(path, assetBytes) : isModelFileValid(model, path);

    if (await isValid(dest)) {
      return true;
    }
    if (!assetInfo.exists) {
      return false;
    }

    const dirInfo = await getInfoAsync(destDir);
    if (!dirInfo.exists) {
      await makeDirectoryAsync(destDir, { intermediates: true });
    }

    void analyticsService.track('bundled_model_copy_started', { model_id: model.id });
    const startedAt = Date.now();

    // Clear any partial copy (temp or final) from an interrupted attempt.
    await deleteAsync(tempDest, { idempotent: true }).catch(() => {});
    await deleteAsync(dest, { idempotent: true }).catch(() => {});
    await copyAsync({ from: assetUri, to: tempDest });

    const ok = await isValid(tempDest);
    if (ok) {
      await moveAsync({ from: tempDest, to: dest });
      void analyticsService.track('bundled_model_copy_completed', {
        model_id: model.id,
        duration_ms: Date.now() - startedAt,
      });
    } else {
      void analyticsService.track('bundled_model_copy_failed', {
        model_id: model.id,
        error: 'copy_verification_failed',
      });
      await deleteAsync(tempDest, { idempotent: true }).catch(() => {});
    }
    return ok;
  } catch (error) {
    void analyticsService.track('bundled_model_copy_failed', {
      model_id: model.id,
      error: String(error instanceof Error ? error.message : error).slice(0, 100),
    });
    await deleteAsync(tempDest, { idempotent: true }).catch(() => {});
    return false;
  } finally {
    releaseTemp();
  }
}
