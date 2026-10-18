import { getModelMemoryVerdict } from '../deviceCapability';

const GB = 1024 ** 3;

describe('getModelMemoryVerdict', () => {
  // iOS cap = 55% of RAM; footprint = size * 1.4.
  describe('iOS thresholds', () => {
    const RAM_4GB = 4 * GB; // usable cap ≈ 2.2 GiB

    it('passes small models on a 4GB device', () => {
      // 0.53 GB starter model → footprint ≈ 0.74 GiB, well under cap
      expect(getModelMemoryVerdict(569_000_000, RAM_4GB, 'ios')).toBe('ok');
    });

    it('flags a ~1.5GB model as tight on a 4GB device', () => {
      // footprint ≈ 2.1 GiB vs cap 2.2 GiB → within the 15% margin
      expect(getModelMemoryVerdict(1.5 * GB, RAM_4GB, 'ios')).toBe('tight');
    });

    it('rejects a ~2.8GB model on a 4GB device', () => {
      // footprint ≈ 3.64 GiB > cap 2.2 GiB
      expect(getModelMemoryVerdict(2_792_000_000, RAM_4GB, 'ios')).toBe('unsupported');
    });

    it('allows larger models on a 6GB device', () => {
      const RAM_6GB = 6 * GB; // cap ≈ 3.3 GiB
      // 2.0 GiB model → footprint 2.8 GiB < 0.85 * cap (2.805 GiB) → ok
      expect(getModelMemoryVerdict(2 * GB, RAM_6GB, 'ios')).toBe('ok');
      // 2.44 GB model → footprint ≈ 3.42 GiB > cap → unsupported
      expect(getModelMemoryVerdict(2_621_343_744, RAM_6GB, 'ios')).toBe('unsupported');
    });
  });

  describe('Android thresholds (65% cap)', () => {
    const RAM_4GB = 4 * GB; // usable cap = 2.6 GiB

    it('is more permissive than iOS for the same hardware', () => {
      // 1.5 GiB model: footprint 2.1 GiB vs cap 2.6 GiB (85% = 2.21) → ok,
      // while the same model on iOS is 'tight'.
      expect(getModelMemoryVerdict(1.5 * GB, RAM_4GB, 'android')).toBe('ok');
    });

    it('flags models near the cap as tight', () => {
      // 1.7 GiB model: footprint 2.38 GiB, between 85% (2.21) and 100% of cap
      expect(getModelMemoryVerdict(1.7 * GB, RAM_4GB, 'android')).toBe('tight');
    });

    it('rejects models whose footprint exceeds the cap', () => {
      // 2 GiB model: footprint 2.8 GiB > cap 2.6 GiB
      expect(getModelMemoryVerdict(2 * GB, RAM_4GB, 'android')).toBe('unsupported');
    });
  });

  describe('exact boundaries', () => {
    // Craft totalMemory so the cap is a round number: android cap = 65%.
    // totalMemory 1000 → cap 650; tight band is (552.5, 650].
    const TOTAL = 1000;

    it('footprint exactly at the cap is tight, just above is unsupported', () => {
      // size 464 → footprint 649.6 ≤ 650 → tight
      expect(getModelMemoryVerdict(464, TOTAL, 'android')).toBe('tight');
      // size 465 → footprint 651 > 650 → unsupported
      expect(getModelMemoryVerdict(465, TOTAL, 'android')).toBe('unsupported');
    });

    it('footprint at 85% of cap is ok, just above is tight', () => {
      // size 394 → footprint 551.6 ≤ 552.5 → ok
      expect(getModelMemoryVerdict(394, TOTAL, 'android')).toBe('ok');
      // size 395 → footprint 553 > 552.5 → tight
      expect(getModelMemoryVerdict(395, TOTAL, 'android')).toBe('tight');
    });
  });

  describe('missing or invalid data never blocks', () => {
    it('returns ok when totalMemory is null', () => {
      expect(getModelMemoryVerdict(10 * GB, null, 'ios')).toBe('ok');
    });

    it('returns ok when totalMemory is zero or negative', () => {
      expect(getModelMemoryVerdict(10 * GB, 0, 'ios')).toBe('ok');
      expect(getModelMemoryVerdict(10 * GB, -1, 'android')).toBe('ok');
    });

    it('returns ok for invalid model sizes', () => {
      expect(getModelMemoryVerdict(0, 4 * GB, 'ios')).toBe('ok');
      expect(getModelMemoryVerdict(NaN, 4 * GB, 'ios')).toBe('ok');
    });
  });
});
