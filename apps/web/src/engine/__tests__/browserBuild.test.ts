import { afterEach, describe, expect, it, vi } from 'vitest';

/** What the browser build offers and runs where wllama's main build can't: no model it can't load, no engine from a CDN. */

vi.mock('../../native', () => ({ hasNativeEngine: () => false }));

async function browserCatalog(mainBuild: boolean) {
  vi.resetModules();
  vi.doMock('../wasm', () => ({ runsMainBuild: () => mainBuild, hasJspi: () => mainBuild, hasMemory64: () => mainBuild }));
  return import('../../catalog');
}

afterEach(() => vi.doUnmock('../wasm'));

describe('the browser catalog', () => {
  it('offers Gemma 4 E2B, a file over 2 GiB, where wllama’s main build runs', async () => {
    const { LOCAL_MODELS } = await browserCatalog(true);
    expect(LOCAL_MODELS.map(m => m.id)).toEqual(['qwen35-0.8b', 'qwen35-2b', 'llama32-3b', 'gemma4-e2b']);
    const gemma = LOCAL_MODELS.find(m => m.id === 'gemma4-e2b')!;
    expect(gemma.files[0].sizeBytes).toBeGreaterThan(2 ** 31);
    expect(gemma.native).toBeUndefined();
    expect(gemma.supportsThinking).toBe(true);
  });

  it('leaves it out where only the compatibility build runs (it can’t load the file there)', async () => {
    const { LOCAL_MODELS } = await browserCatalog(false);
    expect(LOCAL_MODELS.map(m => m.id)).toEqual(['qwen35-0.8b', 'qwen35-2b', 'llama32-3b']);
    for (const m of LOCAL_MODELS) for (const f of m.files) expect(f.sizeBytes, m.id).toBeLessThan(2 ** 31);
  });
});

describe('the compatibility build', () => {
  it('is the app’s own copy, never wllama’s default from jsDelivr', async () => {
    const { WLLAMA_COMPAT } = await import('../compat');
    expect(WLLAMA_COMPAT.wasm).not.toMatch(/^https?:/);
    expect(WLLAMA_COMPAT.wasm).toMatch(/wllama-compat/);
    expect(WLLAMA_COMPAT.worker.code.length).toBeGreaterThan(10_000);
  });

  it('is always set by the engine before a model loads, so wllama never falls back to its CDN', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../localEngine.ts', import.meta.url), 'utf8');
    const created = source.indexOf('new Wllama(');
    expect(source.indexOf('wllama.setCompat(await compatBuild())', created)).toBeGreaterThan(created);
    expect(source.indexOf('wllama.setCompat(await compatBuild())', created)).toBeLessThan(source.indexOf('wllama.loadModel(', created));
  });
});
