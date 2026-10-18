import type { ChatTurn, GenerationUpdate } from '../engine/localEngine';
import { apiFetch, ApiError } from './api';

/**
 * Cloud replies from /api/chat (server-sent events). Streams the full text
 * so far through onUpdate, like the local engine.
 */

export interface CloudResult {
  content: string;
  reasoning: string;
  stopped: boolean;
  charged: number;
  balance: number | null;
  freeRemaining: number | null;
}

let current: AbortController | null = null;

export function stopCloud(): void {
  current?.abort();
}

export async function generateCloud(
  modelId: string,
  messages: ChatTurn[],
  options: { thinking: boolean; onUpdate: (update: GenerationUpdate) => void },
): Promise<CloudResult> {
  current?.abort();
  const controller = new AbortController();
  current = controller;
  const result: CloudResult = { content: '', reasoning: '', stopped: false, charged: 0, balance: null, freeRemaining: null };

  try {
    const response = await apiFetch('chat', {
      body: { model: modelId, messages, thinking: options.thinking },
      signal: controller.signal,
    });
    const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += value;
      let split: number;
      while ((split = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        const event = /^event: (.+)$/m.exec(block)?.[1];
        const data = /^data: (.+)$/m.exec(block)?.[1];
        if (!event || !data) continue;
        const payload = JSON.parse(data);
        if (event === 'delta') {
          result.content += payload.c ?? '';
          result.reasoning += payload.r ?? '';
          options.onUpdate({ content: result.content, reasoning: result.reasoning });
        } else if (event === 'done') {
          result.charged = payload.charged ?? 0;
          result.balance = payload.balance ?? null;
          result.freeRemaining = payload.freeRemaining ?? null;
        } else if (event === 'error') {
          throw new ApiError(502, payload.error, payload.message);
        }
      }
    }
  } catch (error) {
    if (controller.signal.aborted) result.stopped = true;
    else throw error;
  } finally {
    if (current === controller) current = null;
  }
  return result;
}
