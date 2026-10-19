import { describe, expect, it, vi } from 'vitest';

vi.mock('../../native', () => ({
  hasNativeEngine: () => true,
  nativeBridge: () => null,
  unwrap: (result: { ok?: unknown; error?: { message: string } }) => {
    if (result.error) throw new Error(result.error.message);
    return result.ok;
  },
}));
const { findLeftovers, removeLeftovers } = await import('../retired');
const { RETIRED_MODELS } = await import('../../catalog');

const ok = (value: unknown) => ({ ok: value });

describe('models the app used to offer', () => {
  it('knows the two it took out, with the files they were made of', () => {
    expect(RETIRED_MODELS.map(m => m.id)).toEqual(['qwen35-0.8b', 'qwen35-2b']);
    for (const model of RETIRED_MODELS) expect(model.files.map(f => f.name)).toEqual(['model.gguf', 'mmproj.gguf']);
  });

  it('finds the ones still on this computer, partial downloads included, and says how much room they take', async () => {
    const state = vi.fn(async (id: string) => ok(id === 'qwen35-2b' ? { installed: true, downloadedBytes: 1_949_063_104, totalBytes: 1_949_063_104 } : { installed: false, downloadedBytes: 300_000_000, totalBytes: 737_504_352 }));
    const found = await findLeftovers({ state, remove: vi.fn() } as never);
    expect(found).toEqual([
      { id: 'qwen35-0.8b', name: 'Qwen3.5 0.8B', bytes: 300_000_000 },
      { id: 'qwen35-2b', name: 'Qwen3.5 2B', bytes: 1_949_063_104 },
    ]);
  });

  it('finds nothing when nothing is there, and leaves a model alone when the app cannot tell', async () => {
    expect(await findLeftovers({ state: vi.fn(async () => ok({ installed: false, downloadedBytes: 0, totalBytes: 1 })), remove: vi.fn() } as never)).toEqual([]);
    expect(await findLeftovers({ state: vi.fn(async () => ({ error: { message: 'no' } })), remove: vi.fn() } as never)).toEqual([]);
  });

  it('removes exactly the ones asked for, by id, and returns any that could not be removed', async () => {
    const remove = vi.fn(async (id: string) => (id === 'qwen35-2b' ? { error: { message: 'busy' } } : ok(null)));
    const left = await removeLeftovers({ state: vi.fn(), remove } as never, [
      { id: 'qwen35-0.8b', name: 'a', bytes: 1 },
      { id: 'qwen35-2b', name: 'b', bytes: 2 },
    ]);
    expect(remove.mock.calls.map(call => call[0])).toEqual(['qwen35-0.8b', 'qwen35-2b']);
    expect(left).toEqual([{ id: 'qwen35-2b', name: 'b', bytes: 2 }]);
  });

  it('removes nothing it was not asked to', async () => {
    const remove = vi.fn();
    expect(await removeLeftovers({ state: vi.fn(), remove } as never, [])).toEqual([]);
    expect(remove).not.toHaveBeenCalled();
  });
});
