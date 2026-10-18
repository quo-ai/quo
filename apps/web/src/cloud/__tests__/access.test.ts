import { describe, expect, it } from 'vitest';
import type { Account } from '../account';
import { isUnlocked, lockOf } from '../access';
import { isNewModel } from '../catalog';
import { describeCost } from '../../ui/format';

const free = { free: true, creditsPerMessage: 0.1 };
const fable = { free: false, creditsPerMessage: 8 };
const haiku = { free: false, creditsPerMessage: 0.3 };

const account = (patch: Partial<Account> = {}): Account => ({
  user: { email: 'me@example.com' }, plan: 'free', subscription: null, credits: 0, free: { limit: 20, remaining: 20 },
  billing: { live: false }, features: { cloud: true, accounts: true, billing: true }, ...patch,
});

describe('which cloud models are locked', () => {
  it('never locks the free model, for anyone', () => {
    expect(lockOf(free, null)).toBeNull();
    expect(lockOf(free, account({ user: null, credits: null }))).toBeNull();
    expect(lockOf(free, account({ credits: 0 }))).toBeNull();
  });

  it('locks every paid model for someone who is signed out, or whose account can’t be reached', () => {
    expect(lockOf(fable, null)).toBe('sign_in');
    expect(lockOf(haiku, account({ user: null, credits: null }))).toBe('sign_in');
  });

  it('locks a paid model for someone signed in without enough credits for a typical message', () => {
    expect(lockOf(fable, account({ credits: 0 }))).toBe('credits');
    expect(lockOf(fable, account({ credits: 7.9 }))).toBe('credits');
    expect(lockOf(fable, account({ credits: null }))).toBe('credits');
  });

  it('unlocks it once they can afford a typical message, so a few credits open cheap models but not dear ones', () => {
    expect(isUnlocked(fable, account({ credits: 8 }))).toBe(true);
    expect(isUnlocked(fable, account({ credits: 1000 }))).toBe(true);
    expect(isUnlocked(haiku, account({ credits: 3 }))).toBe(true);
    expect(isUnlocked(fable, account({ credits: 3 }))).toBe(false);
  });

  it('does not care about the plan: credits are what pay for a message', () => {
    expect(isUnlocked(fable, account({ plan: 'pro', credits: 0 }))).toBe(false);
    expect(isUnlocked(fable, account({ plan: 'free', credits: 50 }))).toBe(true);
  });
});

describe('marking new models', () => {
  const day = 24 * 60 * 60 * 1000;
  const now = Date.parse('2026-10-18T12:00:00Z');

  it('marks a model for two weeks after it came out', () => {
    expect(isNewModel({ released: '2026-10-13' }, now)).toBe(true);
    expect(isNewModel({ released: '2026-10-04' }, now)).toBe(true);
    expect(isNewModel({ released: '2026-10-03' }, now)).toBe(false);
    expect(isNewModel({ released: '2026-09-01' }, now)).toBe(false);
  });

  it('ignores dates it can’t make sense of, and ones in the future', () => {
    expect(isNewModel({ released: 'soon' }, now)).toBe(false);
    expect(isNewModel({ released: '' }, now)).toBe(false);
    expect(isNewModel({ released: new Date(now + 3 * day).toISOString() }, now)).toBe(false);
  });
});

describe('saying what a message costs', () => {
  it('stays readable from the cheapest models to the dearest', () => {
    expect(describeCost(0.03)).toBe('less than 0.1 credits');
    expect(describeCost(0.03, '≈')).toBe('less than 0.1 credits');
    expect(describeCost(0.3)).toBe('about 0.3 credits');
    expect(describeCost(0.96)).toBe('about 1 credit');
    expect(describeCost(1)).toBe('about 1 credit');
    expect(describeCost(8.4, '≈')).toBe('≈ 8 credits');
    expect(describeCost(82)).toBe('about 82 credits');
  });
});
