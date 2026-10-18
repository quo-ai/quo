// Small vector helpers for on-device semantic recall.

export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Rank items by cosine similarity to the query vector and return the top k
 * that clear the minimum score, highest first.
 */
export function topKBySimilarity<T extends { v: number[] }>(
  query: ArrayLike<number>,
  items: T[],
  k: number,
  minScore: number,
): Array<T & { score: number }> {
  return items
    .map(item => ({ ...item, score: cosineSimilarity(query, item.v) }))
    .filter(item => item.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
