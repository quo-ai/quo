import * as Device from 'expo-device';
import { getModelMemoryVerdict } from '@/utils/deviceCapability';

// One-line expectation for a model's speed/quality trade-off on *this*
// phone, shown under its description so users pick knowingly. Very light
// models answer fast but make more mistakes; a model that is heavy relative
// to the device's RAM runs slowly (CPU inference speed tracks how much of
// the phone's resources the model needs). Models that barely fit already get
// the memory warning, so they need no second caveat here.

const LIGHT_MAX_BYTES = 1_000_000_000;
// Runtime footprint (file × overhead) above this share of RAM feels slow.
const SLOW_RAM_SHARE = 0.28;
const RUNTIME_OVERHEAD_FACTOR = 1.4;

export function getModelExpectationHint(
  sizeBytes: number,
  totalMemory: number | null = Device.totalMemory,
): string | null {
  if (sizeBytes > 0 && sizeBytes < LIGHT_MAX_BYTES) return 'Fastest. Can get complex questions wrong.';
  if (!totalMemory || sizeBytes <= 0) return null;
  if (getModelMemoryVerdict(sizeBytes, totalMemory) !== 'ok') return null;
  return sizeBytes * RUNTIME_OVERHEAD_FACTOR > totalMemory * SLOW_RAM_SHARE
    ? 'Replies may be slow on this phone.'
    : null;
}
