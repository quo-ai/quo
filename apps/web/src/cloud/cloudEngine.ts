import type { ChatTurn, GenerationUpdate } from '../engine/localEngine';
import { apiFetch, ApiError } from './api';
import { readEvents } from './sse';

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
    await readEvents(response, (event, payload) => {
      if (event === 'delta') {
        result.content += (payload.c as string | undefined) ?? '';
        result.reasoning += (payload.r as string | undefined) ?? '';
        options.onUpdate({ content: result.content, reasoning: result.reasoning });
      } else if (event === 'done') {
        result.charged = (payload.charged as number | undefined) ?? 0;
        result.balance = (payload.balance as number | null | undefined) ?? null;
        result.freeRemaining = (payload.freeRemaining as number | null | undefined) ?? null;
      } else if (event === 'error') {
        throw new ApiError(502, payload.error as string, payload.message as string);
      }
    });
  } catch (error) {
    if (controller.signal.aborted) result.stopped = true;
    else throw error;
  } finally {
    if (current === controller) current = null;
  }
  return result;
}
