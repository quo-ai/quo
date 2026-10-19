import type { ChatTurn, GenerationUpdate } from '../engine/localEngine';
import { apiFetch, ApiError } from './api';
import { readEvents } from './sse';
import { addSource, type WebSource } from '../../shared/webSources';

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
  /** With web search allowed: whether the model searched; 'limit' is the free searches for today being used up. */
  web: 'searched' | 'not_needed' | 'limit' | null;
  /** The pages the reply drew on, when it searched. */
  sources: WebSource[];
}

let current: AbortController | null = null;

export function stopCloud(): void {
  current?.abort();
}

export async function generateCloud(
  modelId: string,
  messages: ChatTurn[],
  options: { thinking: boolean | 'off' | 'quick' | 'auto' | 'deep'; web?: boolean; onUpdate: (update: GenerationUpdate) => void; onSearch?: (query: string) => void },
): Promise<CloudResult> {
  current?.abort();
  const controller = new AbortController();
  current = controller;
  const result: CloudResult = { content: '', reasoning: '', stopped: false, charged: 0, balance: null, freeRemaining: null, web: null, sources: [] };

  try {
    const response = await apiFetch('chat', {
      body: { model: modelId, messages, thinking: options.thinking, ...(options.web ? { web: true } : {}) },
      signal: controller.signal,
    });
    await readEvents(response, (event, payload) => {
      if (event === 'delta') {
        result.content += (payload.c as string | undefined) ?? '';
        result.reasoning += (payload.r as string | undefined) ?? '';
        options.onUpdate({ content: result.content, reasoning: result.reasoning });
      } else if (event === 'search') {
        options.onSearch?.(typeof payload.q === 'string' ? payload.q.slice(0, 200) : '');
      } else if (event === 'done') {
        result.charged = (payload.charged as number | undefined) ?? 0;
        result.balance = (payload.balance as number | null | undefined) ?? null;
        result.freeRemaining = (payload.freeRemaining as number | null | undefined) ?? null;
        result.web = payload.web === 'searched' || payload.web === 'not_needed' || payload.web === 'limit' ? payload.web : null;
        // From the server, which had it from the search provider: checked again here before it is shown.
        if (Array.isArray(payload.sources)) for (const source of payload.sources as { url?: unknown; title?: unknown }[]) addSource(result.sources, source?.url, source?.title);
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
