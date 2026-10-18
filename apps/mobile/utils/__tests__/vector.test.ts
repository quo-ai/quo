import { cosineSimilarity, topKBySimilarity } from '../vector';

describe('cosineSimilarity', () => {
  it('is 1 for identical vectors and -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it('is 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('is 0 for mismatched or empty vectors', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

describe('topKBySimilarity', () => {
  const items = [
    { id: 'a', v: [1, 0] },
    { id: 'b', v: [0.9, 0.1] },
    { id: 'c', v: [0, 1] },
    { id: 'd', v: [-1, 0] },
  ];

  it('returns the top k above the threshold, best first', () => {
    const result = topKBySimilarity([1, 0], items, 2, 0.5);
    expect(result.map(r => r.id)).toEqual(['a', 'b']);
    expect(result[0].score).toBeGreaterThan(result[1].score);
  });

  it('filters out weak matches even when k is larger', () => {
    const result = topKBySimilarity([1, 0], items, 10, 0.5);
    expect(result.map(r => r.id)).toEqual(['a', 'b']);
  });

  it('returns empty when nothing clears the threshold', () => {
    expect(topKBySimilarity([1, 0], [{ id: 'c', v: [0, 1] }], 3, 0.5)).toEqual([]);
  });
});
