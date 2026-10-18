import AsyncStorage from '@react-native-async-storage/async-storage';
import { analyticsService } from './analyticsService';
import { PREMIUM_FEATURES } from '@/constants/premium';

const TRIAL_STORAGE_KEY = '@feature_trial_uses';

// Free users get a metered taste of selected premium features before the
// paywall — experienced value converts better than a hard feature wall.
export const TRIAL_LIMITS: Record<string, number> = {
  [PREMIUM_FEATURES.VOICE_INPUT]: 3,
};

async function readUsage(): Promise<Record<string, number>> {
  try {
    const raw = await AsyncStorage.getItem(TRIAL_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export async function getRemainingTrialUses(feature: string): Promise<number> {
  const limit = TRIAL_LIMITS[feature];
  if (!limit) return 0;
  const used = (await readUsage())[feature] ?? 0;
  return Math.max(0, limit - used);
}

export async function hasRemainingTrialUses(feature: string): Promise<boolean> {
  return (await getRemainingTrialUses(feature)) > 0;
}

// consumeTrialUse is a read-modify-write on one AsyncStorage key; chain the
// calls so two overlapping consumptions can't both read the same count.
let consumeChain: Promise<unknown> = Promise.resolve();

/**
 * Consume one trial use. Returns the number of uses remaining afterwards,
 * or -1 when the trial is already exhausted (nothing is consumed).
 */
export function consumeTrialUse(feature: string): Promise<number> {
  const run = consumeChain.then(() => consumeTrialUseUnsafe(feature));
  consumeChain = run.catch(() => {});
  return run;
}

async function consumeTrialUseUnsafe(feature: string): Promise<number> {
  const limit = TRIAL_LIMITS[feature];
  if (!limit) return -1;

  const usage = await readUsage();
  const used = usage[feature] ?? 0;
  if (used >= limit) return -1;

  usage[feature] = used + 1;
  try {
    await AsyncStorage.setItem(TRIAL_STORAGE_KEY, JSON.stringify(usage));
  } catch {
    // If persistence fails the use still proceeds — worst case the user
    // gets one extra free run.
  }

  const remaining = limit - usage[feature];
  void analyticsService.track('trial_use_consumed', { feature, remaining, limit });
  if (remaining === 0) {
    void analyticsService.track('trial_exhausted', { feature, limit });
  }
  return remaining;
}
