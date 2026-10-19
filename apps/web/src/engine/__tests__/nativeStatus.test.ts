import { describe, expect, it, vi } from 'vitest';

const status = vi.hoisted(() => ({ value: null as Record<string, unknown> | null, started: [] as number[] }));
vi.mock('../../native', () => ({
  NativeError: class extends Error {},
  unwrap: (result: { ok: unknown }) => result.ok,
  nativeBridge: () => ({
    engine: {
      onEvent: () => {},
      stop: async () => ({ ok: null }),
      start: async ({ contextSize }: { contextSize: number }) => {
        status.started.push(contextSize);
        // The desktop app settled on half the window, because the model did not fit with the one asked for.
        return { ok: { running: true, modelId: 'm', contextSize: Math.floor(contextSize / 2), requestedContextSize: contextSize, backend: 'cpu', gpuAvailable: true } };
      },
    },
  }),
}));
vi.mock('../../device', () => ({ getDeviceProfile: async () => ({ native: null }), engineMemoryGB: () => null }));

const { NativeEngine } = await import('../nativeEngine');
const model = { id: 'm', name: 'M', contextSize: 16384, maxTokens: 1024, sampling: {}, kvBytesPerToken: undefined } as never;

describe('a model that settled on a smaller window than asked for', () => {
  it('is not loaded again for the same request, and the window it really has is known', async () => {
    const engine = new NativeEngine();
    await engine.load(model, { contextSize: 16384 });
    await engine.load(model, { contextSize: 16384 });
    await engine.load(model, { contextSize: 16384 });
    expect(status.started).toEqual([16384]);
    expect(engine.contextSize).toBe(8192);
  });

  it('is loaded again when a larger window is asked for', async () => {
    const engine = new NativeEngine();
    status.started.length = 0;
    await engine.load(model, { contextSize: 16384 });
    await engine.load(model, { contextSize: 32768 });
    expect(status.started).toEqual([16384, 32768]);
  });

  it('says so when there is a graphics card but the model runs on the processor', async () => {
    const engine = new NativeEngine();
    await engine.load(model, { contextSize: 16384 });
    expect(engine.info()).toMatchObject({ gpu: false, gpuMissing: true });
  });
});
