import type { LocalModel } from '../catalog';
import { engineMemoryGB, getDeviceProfile } from '../device';
import { nativeBridge, NativeError, unwrap, type NativeStatus } from '../native';
import { contextFor, maxTokensFor, samplingFor } from './tuning';
import type { ChatTurn, EngineInfo, GenerationResult, GenerationUpdate, InferenceEngine } from './localEngine';

/**
 * The desktop app's engine: llama.cpp's llama-server, run by the main process
 * (apps/desktop/src/engine). Loading a model goes over IPC; the chat itself is
 * a streamed HTTP request to /engine/v1/chat/completions, which the app's
 * protocol handler forwards to the server. Aborting that request stops the
 * model, so Stop works the same as everywhere else.
 *
 * Generations are serialized exactly like the in-browser engine's: starting
 * one aborts and awaits the previous.
 */

interface Sampling {
  temperature: number;
  top_p: number;
  top_k: number;
  min_p: number;
  penalty_present?: number;
  penalty_last_n?: number;
}

export class NativeEngine implements InferenceEngine {
  private status: NativeStatus | null = null;
  private loading: Promise<void> | null = null;
  private current: { controller: AbortController; done: Promise<unknown> } | null = null;

  constructor() {
    // The server can die on its own (out of memory, a crash). Forget the model,
    // so the next message loads it again instead of failing.
    nativeBridge()?.engine.onEvent(event => {
      if (event.type === 'exit') this.status = null;
    });
  }

  get modelId(): string | null {
    return this.status?.running ? this.status.modelId ?? null : null;
  }

  /** The window the loaded model has, in tokens (what was asked for, held back if this computer is short of memory). */
  get contextSize(): number | null {
    return this.status?.running ? this.status.contextSize ?? null : null;
  }

  async load(model: LocalModel, options: { contextSize?: number } = {}): Promise<void> {
    // The window asked for, held back where this computer cannot hold it (tuning.ts).
    const contextSize = contextFor(model, options.contextSize ?? model.contextSize, engineMemoryGB(await getDeviceProfile()));
    // Loaded already, with the room that was asked for.
    const ready = () => this.modelId === model.id && this.status?.contextSize === contextSize;
    if (ready()) return;
    if (this.loading) await this.loading.catch(() => {});
    if (ready()) return;

    const bridge = nativeBridge();
    if (!bridge) throw new NativeError('no_engine', 'The AI engine isn’t available.');
    this.loading = (async () => {
      await this.stop();
      this.status = null;
      this.status = unwrap(await bridge.engine.start({ modelId: model.id, contextSize }));
    })();
    try {
      await this.loading;
    } finally {
      this.loading = null;
    }
  }

  async unload(): Promise<void> {
    await this.stop();
    this.status = null;
    await nativeBridge()?.engine.stop();
  }

  info(): EngineInfo | null {
    if (!this.status?.running) return null;
    const gpu = this.status.backend !== 'cpu';
    return { backend: this.status.backend ?? 'cpu', gpu, device: this.status.device, vision: this.status.vision };
  }

  async stop(): Promise<void> {
    const running = this.current;
    if (!running) return;
    running.controller.abort();
    await running.done.catch(() => {});
  }

  async generate(
    model: LocalModel,
    messages: ChatTurn[],
    options: { thinking: boolean; onUpdate: (update: GenerationUpdate) => void; contextSize?: number },
  ): Promise<GenerationResult> {
    await this.stop();
    await this.load(model, { contextSize: options.contextSize });

    const controller = new AbortController();
    const thinking = options.thinking && model.supportsThinking;
    const sampling: Sampling = samplingFor(model, { thinking });
    const maxTokens = maxTokensFor(model, thinking, this.status?.contextSize ?? model.contextSize);

    const run = (async (): Promise<GenerationResult> => {
      let content = '';
      let reasoning = '';
      let tokens = 0;
      let speed = 0;
      const started = performance.now();
      let firstTokenAt = 0;

      try {
        let response = await this.request(model, messages, sampling, thinking, maxTokens, controller.signal);
        if (response.status === 503) {
          // The server is gone (it crashed or was stopped): load the model again, once.
          this.status = null;
          await this.load(model);
          response = await this.request(model, messages, sampling, thinking, maxTokens, controller.signal);
        }
        if (!response.ok || !response.body) throw new NativeError('generation_failed', await errorText(response));

        const decoder = new TextDecoder();
        let buffer = '';
        for await (const part of response.body as unknown as AsyncIterable<Uint8Array>) {
          buffer += decoder.decode(part, { stream: true });
          const events = buffer.split('\n\n');
          buffer = events.pop() ?? '';
          for (const event of events) {
            const data = event.replace(/^data: /, '').trim();
            if (!data || data === '[DONE]') continue;
            const chunk = JSON.parse(data) as {
              choices?: { delta?: { content?: string | null; reasoning_content?: string | null } }[];
              timings?: { predicted_n?: number; predicted_per_second?: number };
              error?: { message?: string };
            };
            if (chunk.error) throw new NativeError('generation_failed', chunk.error.message ?? 'The model stopped.');
            if (chunk.timings) {
              tokens = chunk.timings.predicted_n ?? tokens;
              speed = chunk.timings.predicted_per_second ?? speed;
            }
            const delta = chunk.choices?.[0]?.delta;
            const piece = delta?.content ?? '';
            const thought = delta?.reasoning_content ?? '';
            if (!piece && !thought) continue;
            if (!firstTokenAt) firstTokenAt = performance.now();
            content += piece;
            reasoning += thought;
            options.onUpdate({ content, reasoning });
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) throw error;
      }

      if (!tokens) tokens = content.length ? Math.ceil((content.length + reasoning.length) / 4) : 0;
      if (!speed && firstTokenAt) speed = tokens / Math.max(0.001, (performance.now() - firstTokenAt) / 1000);
      return {
        content,
        reasoning,
        tokens,
        tokensPerSecond: speed,
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

  private request(model: LocalModel, messages: ChatTurn[], sampling: Sampling, thinking: boolean, maxTokens: number, signal: AbortSignal): Promise<Response> {
    return fetch('/engine/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal,
      body: JSON.stringify({
        messages,
        stream: true,
        max_tokens: maxTokens,
        temperature: sampling.temperature,
        top_p: sampling.top_p,
        top_k: sampling.top_k,
        min_p: sampling.min_p,
        presence_penalty: sampling.penalty_present,
        repeat_last_n: sampling.penalty_last_n,
        ...(model.supportsThinking ? { chat_template_kwargs: { enable_thinking: thinking } } : {}),
      }),
    });
  }
}

async function errorText(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } | string; message?: string };
    return (typeof body.error === 'object' ? body.error?.message : undefined) ?? body.message ?? 'The model couldn’t answer.';
  } catch {
    return 'The model couldn’t answer.';
  }
}
