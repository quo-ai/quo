import { describe, expect, it, vi } from 'vitest';

vi.mock('../../native', () => ({ hasNativeEngine: () => true, nativeBridge: () => null }));
const { DESKTOP_MODELS } = await import('../../catalog');
const { contextFor, hasImages, maxTokensFor, samplingFor, KV_SHARE, MIN_CONTEXT, THINKING_TOKENS } = await import('../tuning');

const model = (id: string) => DESKTOP_MODELS.find(m => m.id === id)!;

describe('the window a model gets', () => {
  it('is the one asked for when the computer can hold it', () => {
    expect(contextFor(model('qwen35-9b'), 32768, 16)).toBe(32768);
    expect(contextFor(model('qwen35-27b'), 32768, 24)).toBe(32768);
    expect(contextFor(model('qwen35-2b'), 32768, 8)).toBe(32768);
  });

  it('is held back for a model that is heavy on memory, on a small computer, never below a usable window', () => {
    const llama = model('llama32-3b');
    expect(contextFor(llama, 16384, 8)).toBe(MIN_CONTEXT); // 8 GB: only about 8K tokens fit in its share
    expect(contextFor(llama, 16384, 16)).toBeGreaterThan(MIN_CONTEXT);
    expect(contextFor(llama, 16384, 2)).toBe(MIN_CONTEXT); // never less than a chat needs
    expect(contextFor(model('phi4-mini'), 16384, 8)).toBe(MIN_CONTEXT);
  });

  it('grows with memory and never passes what was asked, or the share of memory it may take', () => {
    for (const m of DESKTOP_MODELS) {
      let last = 0;
      for (const gb of [4, 8, 12, 16, 24, 32, 64, 128]) {
        const got = contextFor(m, m.contextSize, gb);
        expect(got).toBeGreaterThanOrEqual(Math.min(MIN_CONTEXT, m.contextSize));
        expect(got).toBeLessThanOrEqual(m.contextSize);
        expect(got).toBeGreaterThanOrEqual(last);
        if (got > MIN_CONTEXT) expect(got * m.kvBytesPerToken!).toBeLessThanOrEqual(gb * 2 ** 30 * KV_SHARE);
        last = got;
      }
    }
  });

  it('is left alone when the model or the computer is unknown (a custom model, a browser)', () => {
    expect(contextFor({ kvBytesPerToken: undefined }, 16384, 8)).toBe(16384);
    expect(contextFor(model('llama32-3b'), 16384, null)).toBe(16384);
    expect(contextFor(model('llama32-3b'), 16384, 0)).toBe(16384);
  });
});

describe('how long a reply may be', () => {
  it('is the model’s usual without thinking, and has room for the thinking as well with it', () => {
    const m = model('qwen35-9b');
    expect(maxTokensFor(m, false, 32768)).toBe(4096);
    expect(maxTokensFor(m, true, 32768)).toBe(THINKING_TOKENS);
    expect(maxTokensFor(m, true, 8192)).toBe(4096); // never more than half the window
    expect(maxTokensFor({ maxTokens: 2048 }, true, 8192)).toBe(4096);
    expect(maxTokensFor({ maxTokens: 8000 }, true, 8192)).toBe(8000); // never less than usual
  });
});

describe('sampling, the way each family recommends', () => {
  const pick = (s: ReturnType<typeof samplingFor>) => [s.temperature, s.top_p, s.top_k, s.min_p, s.penalty_present];

  it('uses Qwen’s own sets for the two smallest: text freer, pictures gentler, thinking in between', () => {
    const small = model('qwen35-2b');
    expect(pick(samplingFor(small, { thinking: false, images: false }))).toEqual([1.0, 1.0, 20, 0, 2.0]);
    expect(pick(samplingFor(small, { thinking: false, images: true }))).toEqual([0.7, 0.8, 20, 0, 1.5]);
    expect(pick(samplingFor(small, { thinking: true, images: false }))).toEqual([1.0, 0.95, 20, 0, 1.5]);
    expect(pick(samplingFor(model('qwen35-0.8b'), { thinking: false, images: false }))).toEqual([1.0, 1.0, 20, 0, 2.0]);
  });

  it('keeps the set for the bigger Qwens the same for text and pictures', () => {
    for (const id of ['qwen35-4b', 'qwen35-9b', 'qwen35-27b']) {
      expect(pick(samplingFor(model(id), { thinking: false, images: true }))).toEqual([0.7, 0.8, 20, 0, 1.5]);
      expect(pick(samplingFor(model(id), { thinking: true, images: false }))).toEqual([1.0, 0.95, 20, 0, 1.5]);
    }
  });

  it('keeps the other families’ own recommendations', () => {
    expect(pick(samplingFor(model('gemma4-e2b'), { thinking: false, images: false }))).toEqual([1.0, 0.95, 64, 0, undefined]);
    expect(samplingFor(model('llama32-3b'), { thinking: false, images: false })).toMatchObject({ temperature: 0.6, top_p: 0.9 });
    expect(samplingFor(model('phi4-mini'), { thinking: false, images: false }).temperature).toBeLessThanOrEqual(0.3);
  });

  it('finds pictures in a message', () => {
    expect(hasImages([{ content: 'hi' }])).toBe(false);
    expect(hasImages([{ content: [{ type: 'text' }] }])).toBe(false);
    expect(hasImages([{ content: 'x' }, { content: [{ type: 'text' }, { type: 'image_url' }] }])).toBe(true);
  });
});

describe('the catalog', () => {
  it('knows what a token of window costs for every model, and gives the light models the longer window', () => {
    for (const m of DESKTOP_MODELS) expect(m.kvBytesPerToken, m.id).toBeGreaterThan(0);
    for (const id of ['qwen35-0.8b', 'qwen35-2b', 'qwen35-4b', 'qwen35-9b', 'qwen35-27b', 'gemma4-e2b']) expect(model(id).contextSize, id).toBe(32768);
    expect(model('llama32-3b').contextSize).toBe(16384);
    expect(model('phi4-mini').contextSize).toBe(16384);
  });

  it('never asks for more window than a model has', () => {
    for (const m of DESKTOP_MODELS) expect(m.contextSize).toBeLessThanOrEqual(131072);
  });
});
