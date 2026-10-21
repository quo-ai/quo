import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ARCHITECTURES_RELEASE, ENGINE_ARCHITECTURES } from '../architectures';
import { bitsOf, modelIdFor, parameterCount, quantOf, sortFiles, suggestFile, supportOf, toLocalModel, toRepoResult } from '../huggingface';

const storage = new Map<string, string>();
vi.stubGlobal('localStorage', { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v), removeItem: (k: string) => void storage.delete(k) });
const store = () => import('../hfStore');

const GB = 2 ** 30;

describe('which models the engine can run', () => {
  it('is the list for the engine’s own llama.cpp release (regenerate it with scripts/engine-architectures.mjs)', () => {
    const lock = JSON.parse(readFileSync(new URL('../../../../desktop/engine.lock.json', import.meta.url), 'utf8'));
    expect(ARCHITECTURES_RELEASE).toBe(lock.release);
    expect(ENGINE_ARCHITECTURES.size).toBeGreaterThan(140);
    for (const name of ['llama', 'qwen35', 'gemma4', 'mistral3', 'deepseek2', 'phi3', 'gpt-oss', 'glm4moe']) expect(ENGINE_ARCHITECTURES.has(name), name).toBe(true);
    for (const name of ['clip', 'unknown', 'eagle3', 'dflash', 'gemma4-assistant']) expect(ENGINE_ARCHITECTURES.has(name), name).toBe(false);
  });

  it('marks chat models it loads, models that only embed or speak, ones it can’t load yet, and unknown ones', () => {
    expect(supportOf('qwen35')).toBe('yes');
    expect(supportOf('pangu-embedded')).toBe('yes');
    for (const name of ['nomic-bert', 'gemma-embedding', 'llama-embed', 'qwen3tts', 't5encoder']) expect(supportOf(name), name).toBe('not-chat');
    expect(supportOf('some-future-arch')).toBe('newer-engine');
    expect(supportOf(null)).toBe('unknown');
  });

  it('reads Hugging Face’s answer, notices a thinking switch, and refuses names that aren’t a repository', () => {
    const result = toRepoResult({ id: 'unsloth/Qwen3.5-4B-GGUF', downloads: 10, gguf: { architecture: 'qwen35', context_length: 262144, total: 4.3e9, chat_template: '{% if enable_thinking %}' } })!;
    expect(result).toMatchObject({ repo: 'unsloth/Qwen3.5-4B-GGUF', architecture: 'qwen35', contextLength: 262144, thinking: true, support: 'yes' });
    for (const id of ['../etc', 'a/..', 'a/b..c', '.x/y', 'a/b/c', 'only', 'a b/c', 42]) expect(toRepoResult({ id }), String(id)).toBeNull();
  });
});

describe('the files of a repository', () => {
  it('names the quantization, as Unsloth, bartowski and others write it', () => {
    expect(quantOf('Qwen3.5-4B-Q4_K_M.gguf')).toBe('Q4_K_M');
    expect(quantOf('gemma-4-E2B-it-qat-UD-Q4_K_XL.gguf')).toBe('UD-Q4_K_XL');
    expect(quantOf('sub/model-IQ4_XS.gguf')).toBe('IQ4_XS');
    expect(quantOf('Model.Q8_0.gguf')).toBe('Q8_0');
    expect(quantOf('model-bf16.gguf')).toBe('BF16');
    expect(quantOf('gpt-oss-20b-MXFP4.gguf')).toBe('MXFP4');
    expect(quantOf('plain.gguf')).toBeNull();
  });

  it('keeps single-file models and projectors apart, and leaves out split models, drafters and other files', () => {
    const tree = [
      { type: 'file', path: 'm-Q8_0.gguf', size: 100, lfs: { size: 8 * GB } },
      { type: 'file', path: 'm-Q4_K_M.gguf', lfs: { size: 4 * GB } },
      { type: 'file', path: 'big/m-Q8_0-00001-of-00002.gguf', lfs: { size: 40 * GB } },
      { type: 'file', path: 'mtp-m.gguf', lfs: { size: GB / 8 } },
      { type: 'file', path: 'mmproj-F16.gguf', lfs: { size: GB } },
      { type: 'file', path: 'mmproj-F32.gguf', lfs: { size: 2 * GB } },
      { type: 'file', path: 'README.md', size: 10 },
      { type: 'directory', path: 'big' },
    ];
    const files = sortFiles(tree);
    expect(files.models.map(f => f.path)).toEqual(['m-Q4_K_M.gguf', 'm-Q8_0.gguf']);
    expect(files.models[1].sizeBytes).toBe(8 * GB);
    expect(files.projectors.map(f => f.path)).toEqual(['mmproj-F16.gguf', 'mmproj-F32.gguf']);
  });

  it('suggests 4-bit medium when it fits, else the largest that fits, and never a 1- or 2-bit file', () => {
    const files = sortFiles(['IQ1_M', 'Q2_K', 'Q3_K_M', 'Q4_K_M', 'Q5_K_M', 'Q8_0'].map((q, i) => ({ type: 'file', path: `m-${q}.gguf`, lfs: { size: (i + 2) * GB } }))).models;
    expect(suggestFile(files, 16)?.quant).toBe('Q4_K_M');
    const noMedium = files.filter(f => f.quant !== 'Q4_K_M');
    expect(suggestFile(noMedium, 16)?.quant).toBe('Q8_0');
    expect(suggestFile(files, 8)?.quant).toBe('Q4_K_M'); // 5 GB fits in 6 GB of room
    // Nothing good fits: 4-bit anyway (the list marks it too large), not the 1-bit file.
    expect(suggestFile(files, 4)?.quant).toBe('Q4_K_M');
    expect(suggestFile(files.filter(f => f.quant !== 'Q4_K_M'), 4)?.quant).toBe('Q3_K_M');
    expect(suggestFile([], 16)).toBeNull();
  });

  it('writes model sizes as people do', () => {
    expect([3.6597e9, 29.2768e9, 8.79e9, 2.7e8, 1.2e11].map(parameterCount)).toEqual(['3.7B', '29B', '8.8B', '270M', '120B']);
  });

  it('knows how many bits a quantization takes', () => {
    expect([bitsOf('Q4_K_M'), bitsOf('UD-Q4_K_XL'), bitsOf('IQ2_XXS'), bitsOf('IQ1_M'), bitsOf('Q8_0'), bitsOf('BF16'), bitsOf('F32'), bitsOf('MXFP4'), bitsOf(null)]).toEqual([4, 4, 2, 1, 8, 16, 32, 4, null]);
  });
});

describe('an added model', () => {
  const result = { repo: 'someone/Cool-Model-7B-GGUF', contextLength: 131072, thinking: false };
  const file = { path: 'sub dir/Cool-Model-7B-Q4_K_M.gguf', sizeBytes: 4 * GB, quant: 'Q4_K_M' };

  beforeEach(() => storage.clear());

  it('gets an id the models folder accepts, the same each time, and different for another file', () => {
    const id = modelIdFor(result.repo, file.path);
    expect(id).toMatch(/^hf-[a-z0-9][a-z0-9._-]{0,60}$/);
    expect(id.length).toBeLessThanOrEqual(64);
    expect(modelIdFor(result.repo, file.path)).toBe(id);
    expect(modelIdFor(result.repo, 'Cool-Model-7B-Q8_0.gguf')).not.toBe(id);
    expect(modelIdFor(`x/${'Very-Long-Name-'.repeat(10)}GGUF`, 'a-Q4_K_M.gguf')).toMatch(/^hf-[a-z0-9][a-z0-9._-]{0,60}$/);
  });

  it('downloads its files from that repository on Hugging Face, with a window a computer can hold', () => {
    const model = toLocalModel(result, file, { path: 'mmproj-F16.gguf', sizeBytes: GB, quant: 'F16' });
    expect(model.files.map(f => [f.name, f.url])).toEqual([
      ['model.gguf', 'https://huggingface.co/someone/Cool-Model-7B-GGUF/resolve/main/sub%20dir/Cool-Model-7B-Q4_K_M.gguf'],
      ['mmproj.gguf', 'https://huggingface.co/someone/Cool-Model-7B-GGUF/resolve/main/mmproj-F16.gguf'],
    ]);
    expect(model).toMatchObject({ name: 'Cool-Model-7B (Q4_K_M)', contextSize: 16384, vision: true, native: true, source: { kind: 'huggingface', repo: result.repo } });
  });

  it('is kept and listed, and forgotten', async () => {
    const { addHfModel, forgetHfModel, getHfModels } = await store();
    const model = addHfModel(toLocalModel(result, file, null));
    expect(getHfModels().map(m => m.id)).toEqual([model.id]);
    expect(JSON.parse(storage.get('quo.hfModels')!)).toHaveLength(1);
    forgetHfModel(model.id);
    expect(getHfModels()).toEqual([]);
  });

  it('is never read back pointing anywhere but a Hugging Face file with a known name', async () => {
    vi.resetModules();
    const good = toLocalModel(result, file, null);
    const bad = [
      { ...good, files: [{ ...good.files[0], url: 'https://evil.example/model.gguf' }] },
      { ...good, files: [{ ...good.files[0], url: 'http://huggingface.co/a/b/resolve/main/x.gguf' }] },
      { ...good, files: [{ ...good.files[0], name: '../../model.gguf' }] },
      { ...good, files: [good.files[0], { ...good.files[0] }] },
      { ...good, id: 'qwen35-4b' },
      { ...good, custom: true },
      { ...good, source: undefined },
      { ...good, files: [{ ...good.files[0], sizeBytes: -1 }] },
    ];
    storage.set('quo.hfModels', JSON.stringify([...bad, good]));
    const { getHfModels, addHfModel } = await store();
    expect(getHfModels().map(m => m.id)).toEqual([good.id]);
    for (const entry of bad) expect(() => addHfModel(entry as never)).toThrow();
  });
});
