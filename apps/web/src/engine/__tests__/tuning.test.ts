import { describe, expect, it, vi } from 'vitest';

vi.mock('../../native', () => ({ hasNativeEngine: () => true, nativeBridge: () => null }));
const { DESKTOP_MODELS } = await import('../../catalog');
const { contextFor, maxTokensFor, samplingFor, windowFor, KV_SHARE, MIN_CONTEXT, Q8_SHARE, THINKING_TOKENS } = await import('../tuning');

const model = (id: string) => DESKTOP_MODELS.find(m => m.id === id)!;

const pick = (s: ReturnType<typeof samplingFor>) => [s.temperature, s.top_p, s.top_k, s.min_p, s.penalty_present];

describe('the window a model gets', () => {
  it('is the one asked for when the computer can hold it', () => {
    expect(contextFor(model('qwen35-9b'), 32768, 16)).toBe(32768);
    expect(contextFor(model('qwen38-27b'), 32768, 24)).toBe(32768);
    expect(contextFor(model('qwen35-4b'), 32768, 16)).toBe(32768);
    expect(contextFor(model('qwen35-4b'), 32768, 8)).toBe(27648); // 8 GB: its share of memory holds a little less
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

describe('how the window is stored', () => {
  it('stays 16-bit whenever the window asked for fits, and when memory is unknown', () => {
    expect(windowFor(model('qwen35-4b'), 32768, 16)).toEqual({ contextSize: 32768, kvType: 'f16' });
    expect(windowFor(model('qwen35-4b'), 32768, 8)).toEqual({ contextSize: 32768, kvType: 'q8_0' }); // 27,648 tokens in 16 bits
    expect(windowFor(model('qwen35-4b'), 32768, null)).toEqual({ contextSize: 32768, kvType: 'f16' });
  });

  it('goes to 8 bits where memory holds the window back, and gets about twice the window for it', () => {
    const phi = model('phi4-mini'); // 128 KB a token
    const plain = contextFor(phi, 131072, 16);
    const { contextSize, kvType } = windowFor(phi, 131072, 16);
    expect(kvType).toBe('q8_0');
    expect(contextSize).toBeGreaterThan(plain * 1.8);
    expect(contextSize * phi.kvBytesPerToken! * Q8_SHARE).toBeLessThanOrEqual(16 * 2 ** 30 * KV_SHARE);
  });

  it('never goes under the smallest window a chat needs, and uses 8 bits to make that one fit better', () => {
    expect(windowFor(model('phi4-mini'), 16384, 1)).toEqual({ contextSize: MIN_CONTEXT, kvType: 'q8_0' });
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

  it('uses Qwen’s own sets for the Qwen3.5 models that are left: without thinking, and with it', () => {
    for (const id of ['qwen35-4b', 'qwen35-9b']) {
      expect(pick(samplingFor(model(id), { thinking: false })), id).toEqual([0.7, 0.8, 20, 0, 1.5]);
      expect(pick(samplingFor(model(id), { thinking: true })), id).toEqual([1.0, 0.95, 20, 0, 1.5]);
    }
  });

  it('uses Qwen3.8’s own: the same without thinking, no presence penalty with it', () => {
    expect(pick(samplingFor(model('qwen38-27b'), { thinking: false }))).toEqual([0.7, 0.8, 20, 0, 1.5]);
    expect(pick(samplingFor(model('qwen38-27b'), { thinking: true }))).toEqual([1.0, 0.95, 20, 0, 0]);
  });

  it('keeps the other families’ own recommendations', () => {
    expect(pick(samplingFor(model('gemma4-e2b'), { thinking: false }))).toEqual([1.0, 0.95, 64, 0, undefined]);
    expect(samplingFor(model('llama32-3b'), { thinking: false })).toMatchObject({ temperature: 0.6, top_p: 0.9 });
    expect(samplingFor(model('phi4-mini'), { thinking: false }).temperature).toBeLessThanOrEqual(0.3);
  });
});

describe('the catalog', () => {
  it('knows what a token of window costs for every model, and gives the light models the longer window', () => {
    for (const m of DESKTOP_MODELS) expect(m.kvBytesPerToken, m.id).toBeGreaterThan(0);
    for (const id of ['qwen35-4b', 'qwen35-9b', 'qwen38-27b', 'gemma4-e2b']) expect(model(id).contextSize, id).toBe(32768);
    expect(model('llama32-3b').contextSize).toBe(16384);
    expect(model('phi4-mini').contextSize).toBe(16384);
  });

  it('gives Gemma 4’s larger sizes their memory per token (full-attention layers × 2 × KV heads × 512 × 2 bytes), the long window and thinking', () => {
    expect(model('gemma4-12b').kvBytesPerToken).toBe(8 * 2 * 1 * 512 * 2);
    expect(model('gemma4-26b-a4b').kvBytesPerToken).toBe(5 * 2 * 2 * 512 * 2);
    for (const id of ['gemma4-e2b', 'gemma4-12b', 'gemma4-26b-a4b']) {
      expect(model(id).contextSize, id).toBe(32768);
      expect(model(id).supportsThinking, id).toBe(true);
      expect(pick(samplingFor(model(id), { thinking: true })), id).toEqual([1.0, 0.95, 64, 0, undefined]);
    }
    expect(model('gemma4-12b').files.map(f => f.sizeBytes)).toEqual([6716356800, 175115840, 253708800]);
    expect(model('gemma4-26b-a4b').files.map(f => f.sizeBytes)).toEqual([14249047104, 1193058784, 251939328]);
  });

  it('gives every Gemma 4 its drafter, as an optional file (the model runs without it), from the same repository', () => {
    for (const id of ['gemma4-e2b', 'gemma4-12b', 'gemma4-26b-a4b']) {
      const files = model(id).files;
      expect(files.map(f => f.name), id).toEqual(['model.gguf', 'mmproj.gguf', 'draft.gguf']);
      expect(files.map(f => Boolean(f.optional)), id).toEqual([false, false, true]);
      expect(files[2].url, id).toMatch(/^https:\/\/huggingface\.co\/unsloth\/gemma-4-[^/]+-it-qat-GGUF\/resolve\/main\/mtp-gemma-4-[^/]+-it\.gguf$/);
      expect(new URL(files[2].url).pathname.split('/').slice(1, 3)).toEqual(new URL(files[0].url).pathname.split('/').slice(1, 3));
    }
    for (const m of DESKTOP_MODELS) if (!m.id.startsWith('gemma4')) expect(m.files.some(f => f.optional), m.id).toBe(false);
  });

  it('moved Gemma 4 E2B to the quantization-aware file, and the plain one someone downloaded still counts', () => {
    expect(model('gemma4-e2b').files[0]).toMatchObject({ sizeBytes: 2620370976, altSizes: [3106738272] });
  });

  it('never asks for more window than a model has', () => {
    for (const m of DESKTOP_MODELS) expect(m.contextSize).toBeLessThanOrEqual(131072);
  });
});

describe('the Qwen3.5 models come as the editions that keep the prediction head', () => {
  const urlOf = (id: string, name: string) => model(id).files.find(f => f.name === name)!.url;

  it('are downloaded from Unsloth’s MTP repositories, with the exact sizes of those files', () => {
    expect(urlOf('qwen35-4b', 'model.gguf')).toBe('https://huggingface.co/unsloth/Qwen3.5-4B-MTP-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf');
    expect(urlOf('qwen35-9b', 'mmproj.gguf')).toBe('https://huggingface.co/unsloth/Qwen3.5-9B-MTP-GGUF/resolve/main/mmproj-F16.gguf');
    expect(model('qwen35-4b').files.map(f => f.sizeBytes)).toEqual([2834975040, 672423488]);
    expect(model('qwen35-9b').files.map(f => f.sizeBytes)).toEqual([5868826976, 918165984]);
  });

  it('still count as installed for someone who downloaded the plain editions before', () => {
    expect(model('qwen35-4b').files.map(f => f.altSizes)).toEqual([[2740937888], [672423616]]);
    expect(model('qwen35-9b').files.map(f => f.altSizes)).toEqual([[5680522464], [918166080]]);
    for (const id of ['llama32-3b', 'phi4-mini']) expect(model(id).files.every(f => f.altSizes === undefined), id).toBe(true);
  });

  it('count the prediction head’s extra layer in the memory a token of window takes', () => {
    expect(model('qwen35-4b').kvBytesPerToken).toBe(9 * 2 * 4 * 256 * 2);
  });
});

describe('Qwen3.8 27B replaced Qwen3.5 27B', () => {
  it('comes from Unsloth’s file, which keeps the prediction head, so a token of window costs the same', () => {
    expect(model('qwen38-27b').files.map(f => f.url)).toEqual([
      'https://huggingface.co/unsloth/Qwen3.8-27B-GGUF/resolve/main/Qwen3.8-27B-UD-Q4_K_M.gguf',
      'https://huggingface.co/unsloth/Qwen3.8-27B-GGUF/resolve/main/mmproj-F16.gguf',
    ]);
    expect(model('qwen38-27b').files.map(f => f.sizeBytes)).toEqual([16464440224, 927607488]);
    expect(model('qwen38-27b').kvBytesPerToken).toBe(17 * 2 * 4 * 256 * 2);
    expect(model('qwen38-27b')).toMatchObject({ vision: true, supportsThinking: true, agent: 'good' });
  });

});
