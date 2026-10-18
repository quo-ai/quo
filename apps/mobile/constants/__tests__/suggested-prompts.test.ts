import SUGGESTED_PROMPTS, { getRandomPrompts } from '../suggested-prompts';

describe('suggested prompts bank', () => {
  it('has hundreds of prompts', () => {
    expect(SUGGESTED_PROMPTS.length).toBeGreaterThanOrEqual(900);
  });

  it('has no exact duplicates', () => {
    const seen = new Map<string, number>();
    for (const prompt of SUGGESTED_PROMPTS) {
      seen.set(prompt, (seen.get(prompt) ?? 0) + 1);
    }
    const duplicates = [...seen.entries()].filter(([, n]) => n > 1).map(([p]) => p);
    expect(duplicates).toEqual([]);
  });

  it('every prompt is a complete, sendable question', () => {
    for (const prompt of SUGGESTED_PROMPTS) {
      const trimmed = prompt.trim();
      expect(trimmed.length).toBeGreaterThanOrEqual(12);
      expect(trimmed.length).toBeLessThanOrEqual(120);
      expect(trimmed.endsWith('?')).toBe(true);
    }
  });

  it('getRandomPrompts returns the requested number of unique prompts from the bank', () => {
    const four = getRandomPrompts(4);
    expect(four).toHaveLength(4);
    expect(new Set(four).size).toBe(4);
    for (const question of four) {
      expect(SUGGESTED_PROMPTS).toContain(question);
    }
  });

  it('getRandomPrompts clamps out-of-range counts', () => {
    expect(getRandomPrompts(0)).toEqual([]);
    expect(getRandomPrompts(-3)).toEqual([]);
    const all = getRandomPrompts(SUGGESTED_PROMPTS.length + 10);
    expect(all).toHaveLength(SUGGESTED_PROMPTS.length);
    expect(new Set(all).size).toBe(SUGGESTED_PROMPTS.length);
  });
});
