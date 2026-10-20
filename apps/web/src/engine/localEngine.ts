import { Wllama } from '@wllama/wllama/esm/index.js';
import wasmUrl from '@wllama/wllama/esm/wasm/wllama.wasm?url';
import type { LocalModel } from '../catalog';
import { getDeviceProfile } from '../device';
import { hasNativeEngine } from '../native';
import { getModelBlobs } from '../storage/modelStore';
import { NativeEngine } from './nativeEngine';
import { runsMainBuild } from './wasm';

/**
 * In-browser inference via wllama (llama.cpp → WebAssembly): WebGPU when the
 * browser supports it, multi-threaded CPU otherwise. Loads the model straight
 * from OPFS blobs, so nothing is re-downloaded.
 *
 * Completions are serialized: starting one aborts and awaits the previous,
 * so two generations never run against the same context.
 *
 * The desktop app uses the native llama.cpp engine instead (nativeEngine.ts)
 * through the same interface; `localEngine` at the bottom is whichever applies.
 */

export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant';
  /** Plain text, or text and images (images only reach engines that can read them). */
  content: string | ContentPart[];
}

export const textOf = (content: string | ContentPart[]): string =>
  typeof content === 'string' ? content : content.map(part => (part.type === 'text' ? part.text : '')).join('\n').trim();

export interface GenerationUpdate {
  /** Full visible text so far (not a delta). */
  content: string;
  /** Full reasoning text so far, when thinking is on. */
  reasoning: string;
}

export interface GenerationResult extends GenerationUpdate {
  tokens: number;
  tokensPerSecond: number;
  timeToFirstTokenMs: number;
  stopped: boolean;
}

export interface EngineInfo {
  /** 'webgpu', 'cpu', or the native engine's 'vulkan' | 'metal' | 'cuda' | … */
  backend: string;
  /** Running on a graphics card. */
  gpu: boolean;
  /** The graphics card's name, when known. */
  device?: string | null;
  /** There is a graphics card but the model is running on the processor (a driver or backend that didn't load). */
  gpuMissing?: boolean;
  /** The loaded model can read images. */
  vision?: boolean;
  threads?: number;
}

/** What the app needs from an inference engine. */
export interface InferenceEngine {
  readonly modelId: string | null;
  /** `contextSize` asks for a larger window than the model's default (Code mode needs room for files and tool results). */
  load(model: LocalModel, options?: { contextSize?: number }): Promise<void>;
  unload(): Promise<void>;
  info(): EngineInfo | null;
  stop(): Promise<void>;
  generate(
    model: LocalModel,
    messages: ChatTurn[],
    options: { thinking: boolean; onUpdate: (update: GenerationUpdate) => void; /** A larger window than the model's default (the native engine only). */ contextSize?: number },
  ): Promise<GenerationResult>;
}

/**
 * The build this browser runs: wllama's main one needs JSPI and 64-bit memory, and falls back to a compatibility build
 * without them, except in Firefox (wllama runs the main build there). Quo hosts that build (compat.ts); never let wllama
 * fetch it from its CDN.
 */
const needsCompat = (): boolean => !/firefox/i.test(navigator.userAgent) && !runsMainBuild();

const compatBuild = async () => (needsCompat() ? (await import('./compat')).WLLAMA_COMPAT : null);

class LocalEngine implements InferenceEngine {
  private wllama: Wllama | null = null;
  private loadedModelId: string | null = null;
  private usingGpu = false;
  private loading: Promise<void> | null = null;
  private current: { controller: AbortController; done: Promise<unknown> } | null = null;

  get modelId(): string | null {
    return this.loadedModelId;
  }

  async load(model: LocalModel): Promise<void> {
    if (this.loadedModelId === model.id) return;
    if (this.loading) await this.loading.catch(() => {});
    if (this.loadedModelId === model.id) return;

    this.loading = (async () => {
      await this.unload();
      const device = await getDeviceProfile();
      const wllama = new Wllama({ default: wasmUrl }, { suppressNativeLog: !import.meta.env.DEV });
      wllama.setCompat(await compatBuild());
      const blobs = await getModelBlobs(model);
      await wllama.loadModel(blobs, {
        n_ctx: model.contextSize,
        reasoning: model.supportsThinking,
        // A software (fallback) WebGPU adapter is slower than the CPU path.
        ...(device.gpu ? {} : { n_gpu_layers: 0 }),
      });
      this.wllama = wllama;
      this.usingGpu = device.gpu;
      this.loadedModelId = model.id;
    })();
    try {
      await this.loading;
    } finally {
      this.loading = null;
    }
  }

  async unload(): Promise<void> {
    await this.stop();
    const wllama = this.wllama;
    this.wllama = null;
    this.loadedModelId = null;
    if (wllama) await wllama.exit().catch(() => {});
  }

  info(): EngineInfo | null {
    if (!this.wllama) return null;
    return {
      backend: this.usingGpu ? 'webgpu' : 'cpu',
      gpu: this.usingGpu,
      threads: this.wllama.getNumThreads(),
    };
  }

  /** Stops the running generation, if any, and waits for it to settle. */
  async stop(): Promise<void> {
    const running = this.current;
    if (!running) return;
    running.controller.abort();
    await running.done.catch(() => {});
  }

  async generate(
    model: LocalModel,
    messages: ChatTurn[],
    options: { thinking: boolean; onUpdate: (update: GenerationUpdate) => void },
  ): Promise<GenerationResult> {
    await this.stop();
    await this.load(model);
    const wllama = this.wllama;
    if (!wllama) throw new Error('engine_not_loaded');

    const controller = new AbortController();
    const thinking = options.thinking && model.supportsThinking;
    const sampling = { ...model.sampling, ...(thinking ? model.thinkingSampling : undefined) };

    const run = (async (): Promise<GenerationResult> => {
      let content = '';
      let reasoning = '';
      let tokens = 0;
      const started = performance.now();
      let firstTokenAt = 0;

      try {
        const stream = await wllama.createChatCompletion({
          messages: messages.map(turn => ({ role: turn.role, content: textOf(turn.content) })),
          stream: true,
          max_tokens: model.maxTokens,
          abortSignal: controller.signal,
          chat_template_kwargs: model.supportsThinking ? { enable_thinking: thinking } : undefined,
          temperature: sampling.temperature,
          top_p: sampling.top_p,
          top_k: sampling.top_k,
          min_p: sampling.min_p,
          penalty_present: sampling.penalty_present,
          penalty_last_n: sampling.penalty_last_n,
        });
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta as { content?: string | null; reasoning_content?: string | null } | undefined;
          const piece = delta?.content ?? '';
          const thought = delta?.reasoning_content ?? '';
          if (!piece && !thought) continue;
          if (!firstTokenAt) firstTokenAt = performance.now();
          tokens++;
          content += piece;
          reasoning += thought;
          options.onUpdate({ content, reasoning });
        }
      } catch (error) {
        if (!controller.signal.aborted) throw error;
      }

      const generationSeconds = firstTokenAt ? (performance.now() - firstTokenAt) / 1000 : 0;
      return {
        content,
        reasoning,
        tokens,
        tokensPerSecond: generationSeconds > 0 ? (tokens - 1) / generationSeconds : 0,
        timeToFirstTokenMs: firstTokenAt ? firstTokenAt - started : 0,
        stopped: controller.signal.aborted,
      };
    })();

    this.current = { controller, done: run };
    try {
      return await run;
    } finally {
      if (this.current?.controller === controller) this.current = null;
    }
  }
}

export const localEngine: InferenceEngine = hasNativeEngine() ? new NativeEngine() : new LocalEngine();
