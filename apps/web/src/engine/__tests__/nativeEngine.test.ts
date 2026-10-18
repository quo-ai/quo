import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LocalModel } from '../../catalog';
import { NativeEngine } from '../nativeEngine';

const model = { id: 'qwen35-9b', name: 'Qwen', contextSize: 16384 } as LocalModel;

function engine() {
  const start = vi.fn(async (options: { modelId: string; contextSize: number }) => ({ ok: { running: true, modelId: options.modelId, contextSize: options.contextSize, backend: 'vulkan' } }));
  const stop = vi.fn(async () => ({ ok: true }));
  vi.stubGlobal('window', { quoDesktop: { platform: 'linux', version: '1', engine: { start, stop, onEvent: () => () => {} }, models: {} } });
  return { native: new NativeEngine(), start };
}

afterEach(() => vi.unstubAllGlobals());

describe('loading a model into the native engine', () => {
  it('loads it once at its own window size, however often it is asked for', async () => {
    const { native, start } = engine();
    await native.load(model);
    await native.load(model);
    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith({ modelId: 'qwen35-9b', contextSize: 16384 });
  });

  it('loads it again, with more room, when Code mode asks for a larger window — and again when a chat wants the default back', async () => {
    const { native, start } = engine();
    await native.load(model);
    await native.load(model, { contextSize: 32768 });
    await native.load(model, { contextSize: 32768 });
    expect(start.mock.calls.map(call => call[0].contextSize)).toEqual([16384, 32768]);
    await native.load(model);
    expect(start.mock.calls.map(call => call[0].contextSize)).toEqual([16384, 32768, 16384]);
  });
});
