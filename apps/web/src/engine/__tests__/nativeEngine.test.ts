import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LocalModel } from '../../catalog';
import { NativeEngine } from '../nativeEngine';

const model = { id: 'qwen35-9b', name: 'Qwen', contextSize: 16384 } as LocalModel;

function engine() {
  const start = vi.fn(async (options: { modelId: string; contextSize: number }) => ({ ok: { running: true, modelId: options.modelId, contextSize: options.contextSize, backend: 'vulkan' } }));
  const stop = vi.fn(async () => ({ ok: true }));
  let send: (event: { type: string }) => void = () => {};
  const onEvent = (listener: typeof send) => ((send = listener), () => {});
  vi.stubGlobal('window', { quoDesktop: { platform: 'linux', version: '1', engine: { start, stop, onEvent }, models: {} } });
  return { native: new NativeEngine(), start, event: (event: { type: string }) => send(event) };
}

// What llama-server streams back: one piece of text, then the end.
const reply = (text: string) => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`, { status: 200 });
const gone = () => new Response(JSON.stringify({ error: 'engine_not_running' }), { status: 503 });
const ask = (native: NativeEngine, contextSize?: number) => native.generate(model, [{ role: 'user', content: 'hi' }], { thinking: false, onUpdate: () => {}, contextSize });

afterEach(() => vi.unstubAllGlobals());

describe('loading a model into the native engine', () => {
  it('loads it once at its own window size, however often it is asked for', async () => {
    const { native, start } = engine();
    await native.load(model);
    await native.load(model);
    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith({ modelId: 'qwen35-9b', contextSize: 16384, kvType: 'f16' });
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

describe('a model that was let go', () => {
  it('loads again with the next message when main says it let the model go (idle, or an image needed the memory)', async () => {
    const { native, start, event } = engine();
    vi.stubGlobal('fetch', vi.fn(async () => reply('Hello')));
    await native.load(model);
    event({ type: 'exit' });
    expect(native.modelId).toBe(null); // so the chat shows it loading
    expect((await ask(native)).content).toBe('Hello');
    expect(start).toHaveBeenCalledTimes(2);
  });

  it('loads again and answers when the server went away unannounced, with the window that was asked for', async () => {
    const { native, start } = engine();
    const answers = [gone(), reply('Back again')];
    vi.stubGlobal('fetch', vi.fn(async () => answers.shift()!));
    await native.load(model, { contextSize: 32768 });
    const result = await Promise.race([ask(native, 32768), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('the reply waited on itself')), 2000))]);
    expect(result.content).toBe('Back again');
    expect(start.mock.calls.map(call => call[0].contextSize)).toEqual([32768, 32768]);
  });
});
