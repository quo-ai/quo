import { describe, expect, it, vi } from 'vitest';

vi.mock('../../native', () => ({ hasNativeEngine: () => true, nativeBridge: () => null, unwrap: (r: { ok: unknown }) => r.ok }));
const { DESKTOP_MODELS } = await import('../../catalog');
const { stateFilesOf } = await import('../nativeDownloads');

describe('what the desktop app is asked about a model on disk', () => {
  it('passes on which files are optional, so a model without its drafter still counts as installed', () => {
    const gemma = DESKTOP_MODELS.find(m => m.id === 'gemma4-12b')!;
    expect(stateFilesOf(gemma).map(f => [f.name, Boolean((f as { optional?: boolean }).optional)])).toEqual([['model.gguf', false], ['mmproj.gguf', false], ['draft.gguf', true]]);
  });

  it('passes on the sizes earlier editions had, and nothing it was not given', () => {
    const qwen = DESKTOP_MODELS.find(m => m.id === 'qwen35-4b')!;
    expect(stateFilesOf(qwen)[0]).toEqual({ url: qwen.files[0].url, name: 'model.gguf', sizeBytes: qwen.files[0].sizeBytes, altSizes: qwen.files[0].altSizes });
    const llama = DESKTOP_MODELS.find(m => m.id === 'llama32-3b')!;
    expect(Object.keys(stateFilesOf(llama)[0]).sort()).toEqual(['name', 'sizeBytes', 'url']);
  });
});
