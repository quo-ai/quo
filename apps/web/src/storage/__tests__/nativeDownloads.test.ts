import { describe, expect, it, vi } from 'vitest';
import type { LocalModel } from '../../catalog';

vi.mock('../../native', () => ({ hasNativeEngine: () => true, nativeBridge: () => null, unwrap: (r: { ok: unknown }) => r.ok }));
const { stateFilesOf } = await import('../nativeDownloads');

const file = (name: string, extra = {}) => ({ url: `https://huggingface.co/a/b/resolve/main/${name}`, name, sizeBytes: 100, ...extra });

describe('what the desktop app is asked about a model on disk', () => {
  it('passes on which files are optional and the sizes earlier editions had, and nothing else', () => {
    const model = { files: [file('model.gguf', { altSizes: [90] }), file('mmproj.gguf'), file('draft.gguf', { optional: true })] } as unknown as LocalModel;
    expect(stateFilesOf(model)).toEqual([file('model.gguf', { altSizes: [90] }), file('mmproj.gguf'), file('draft.gguf', { optional: true })]);
    const plain = { files: [{ ...file('model.gguf'), extra: 'ignored' }] } as unknown as LocalModel;
    expect(Object.keys(stateFilesOf(plain)[0]).sort()).toEqual(['name', 'sizeBytes', 'url']);
  });
});
