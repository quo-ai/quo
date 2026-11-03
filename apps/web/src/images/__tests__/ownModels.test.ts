// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../storage/downloads', () => ({ downloadState: () => undefined }));
const { addOwnImageModel, ownImageModels, refreshOwnImageModels } = await import('../ownModels');
const { deviceImageModel } = await import('../device');
const { setImagePrefs } = await import('../prefs');

const entry = { id: 'imgc-0123456789ab', name: 'My XL', family: 'sdxl', label: 'SDXL', steps: 28, cfg: 6, edits: false };
afterEach(() => vi.unstubAllGlobals());

describe('image models from the person’s own files', () => {
  it('are listed from the desktop app without any path, and used like Quo’s own', async () => {
    let list = [entry];
    vi.stubGlobal('window', { quoDesktop: { images: { make: async () => ({}), cancel: async () => ({}), onEvent: () => () => {}, custom: {
      list: async () => ({ ok: list }), pick: async () => ({ ok: entry }), remove: async () => ({ ok: null }),
    } } } });
    await refreshOwnImageModels();
    expect(ownImageModels().map(model => [model.id, model.steps, model.files.length])).toEqual([[entry.id, 28, 0]]);
    setImagePrefs({ model: entry.id });
    expect(deviceImageModel()?.id).toBe(entry.id);
    list = [];
    await refreshOwnImageModels();
    expect(deviceImageModel()).toBeNull();
    setImagePrefs({ model: null });
  });

  it('passes on why a file can’t be used', async () => {
    vi.stubGlobal('window', { quoDesktop: { images: { custom: { list: async () => ({ ok: [] }), pick: async () => ({ error: { code: 'unsupported', message: 'Quo can’t run this kind of image model.' } }), remove: async () => ({ ok: null }) } } } });
    await expect(addOwnImageModel()).rejects.toThrow('can’t run this kind');
  });
});
