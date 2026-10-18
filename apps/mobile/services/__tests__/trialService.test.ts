import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('../analyticsService', () => ({
  analyticsService: { track: jest.fn(async () => {}) },
}));

import { getRemainingTrialUses, hasRemainingTrialUses, consumeTrialUse, TRIAL_LIMITS } from '../trialService';
import { analyticsService } from '../analyticsService';

const VOICE = 'Voice Input';

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

describe('trialService', () => {
  it('starts with the full trial allowance', async () => {
    expect(await getRemainingTrialUses(VOICE)).toBe(TRIAL_LIMITS[VOICE]);
    expect(await hasRemainingTrialUses(VOICE)).toBe(true);
  });

  it('counts down on each consumption and persists across reads', async () => {
    expect(await consumeTrialUse(VOICE)).toBe(TRIAL_LIMITS[VOICE] - 1);
    expect(await getRemainingTrialUses(VOICE)).toBe(TRIAL_LIMITS[VOICE] - 1);
  });

  it('returns -1 once exhausted and consumes nothing further', async () => {
    for (let i = 0; i < TRIAL_LIMITS[VOICE]; i++) {
      expect(await consumeTrialUse(VOICE)).toBe(TRIAL_LIMITS[VOICE] - 1 - i);
    }
    expect(await consumeTrialUse(VOICE)).toBe(-1);
    expect(await hasRemainingTrialUses(VOICE)).toBe(false);
  });

  it('emits trial_exhausted exactly when the last use is consumed', async () => {
    for (let i = 0; i < TRIAL_LIMITS[VOICE]; i++) {
      await consumeTrialUse(VOICE);
    }
    const events = (analyticsService.track as jest.Mock).mock.calls.map(c => c[0]);
    expect(events.filter(e => e === 'trial_use_consumed')).toHaveLength(TRIAL_LIMITS[VOICE]);
    expect(events.filter(e => e === 'trial_exhausted')).toHaveLength(1);
  });

  it('serializes overlapping consumptions (no lost updates)', async () => {
    const results = await Promise.all(
      Array.from({ length: TRIAL_LIMITS[VOICE] + 2 }, () => consumeTrialUse(VOICE)),
    );
    const expected = Array.from({ length: TRIAL_LIMITS[VOICE] }, (_, i) => TRIAL_LIMITS[VOICE] - 1 - i);
    expect(results).toEqual([...expected, -1, -1]);
    expect(await getRemainingTrialUses(VOICE)).toBe(0);
  });

  it('treats features without a configured trial as having no uses', async () => {
    expect(await getRemainingTrialUses('Thinking Mode')).toBe(0);
    expect(await consumeTrialUse('Thinking Mode')).toBe(-1);
  });
});
