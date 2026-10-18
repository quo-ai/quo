import { Alert, Platform } from 'react-native';
import * as Device from 'expo-device';

/**
 * Device-RAM-based gating for large on-device models.
 *
 * Heuristic (deliberately conservative and simple):
 * - Runtime footprint ≈ model file size + ~40% for KV cache, context buffers,
 *   mmproj/vision weights, and general llama.cpp overhead.
 * - iOS enforces a hard per-app memory cap and jetsams the process with no
 *   catchable error when exceeded. Even though the app declares the
 *   increased-memory-limit entitlement, it is not guaranteed on older
 *   devices, so we assume a usable cap of ~55% of total RAM.
 * - Android has softer failure modes (LMK, heavy swapping) so we allow a
 *   slightly higher cap of ~65% of total RAM.
 * - 'tight' when the estimated footprint lands within 15% of the cap;
 *   'unsupported' when it exceeds the cap.
 * - When totalMemory is unknown (Device.totalMemory is null), return 'ok' —
 *   never block a user on missing data.
 *
 * The optional overrides keep the function pure/testable: tests pass
 * totalMemory (and platform) explicitly and never touch the native module.
 */

export type ModelMemoryVerdict = 'ok' | 'tight' | 'unsupported';

// Estimated runtime multiplier over raw file size (KV cache/context/overhead).
const RUNTIME_OVERHEAD_FACTOR = 1.4;
// Fraction of total RAM assumed usable by the app before the OS intervenes.
const IOS_USABLE_RAM_FRACTION = 0.55;
const ANDROID_USABLE_RAM_FRACTION = 0.65;
// 'tight' when the footprint is within this fraction of the cap.
const TIGHT_MARGIN = 0.15;

export function getModelMemoryVerdict(
  sizeBytes: number,
  totalMemory: number | null = Device.totalMemory,
  platform: string = Platform.OS,
): ModelMemoryVerdict {
  // Missing or nonsensical data: never block the user.
  if (totalMemory == null || totalMemory <= 0 || !Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return 'ok';
  }

  const usableFraction =
    platform === 'ios' ? IOS_USABLE_RAM_FRACTION : ANDROID_USABLE_RAM_FRACTION;
  const usableCap = totalMemory * usableFraction;
  const estimatedFootprint = sizeBytes * RUNTIME_OVERHEAD_FACTOR;

  if (estimatedFootprint > usableCap) return 'unsupported';
  if (estimatedFootprint > usableCap * (1 - TIGHT_MARGIN)) return 'tight';
  return 'ok';
}

/**
 * Warn (but never hard-block) before downloading/selecting a model whose
 * estimated runtime footprint exceeds this device's usable memory — users
 * may know better, and iOS jetsams with no catchable error if they don't.
 * Calls `proceed` immediately when the model fits.
 */
export function confirmMemoryThenProceed(
  model: { name: string; sizeBytes: number },
  isDownloaded: boolean,
  proceed: () => void,
): void {
  if (getModelMemoryVerdict(model.sizeBytes) !== 'unsupported') {
    proceed();
    return;
  }
  Alert.alert(
    isDownloaded ? 'Use anyway?' : 'Download anyway?',
    `${model.name} exceeds this device's memory and may crash the app.`,
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: isDownloaded ? 'Use Anyway' : 'Download Anyway',
        style: 'destructive',
        onPress: proceed,
      },
    ],
  );
}
