import { config } from './env.js';
import type { CloudModel } from './cloudModels.js';

/**
 * Streams a chat completion from OpenRouter (OpenAI-compatible SSE).
 * Requests only providers that don't collect or retain data. Without an
 * API key (sandbox) a stand-in model streams a labelled test reply.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface StreamDelta {
  content?: string;
  reasoning?: string;
}

export interface StreamUsage {
  promptTokens: number;
  completionTokens: number;
  /** USD, as reported by OpenRouter; null for the stand-in. */
  costUsd: number | null;
}

export class UpstreamError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function streamChat(
  model: CloudModel,
  messages: ChatMessage[],
  options: { maxTokens: number; thinking: boolean; signal: AbortSignal; onDelta: (delta: StreamDelta) => void },
): Promise<StreamUsage> {
  if (!config.openRouterKey) return standIn(model, messages, options);

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    signal: options.signal,
    headers: {
      authorization: `Bearer ${config.openRouterKey}`,
      'content-type': 'application/json',
      'http-referer': config.appUrl,
      'x-title': 'Quo',
    },
    body: JSON.stringify({
      model: model.id,
      messages,
      stream: true,
      max_tokens: options.maxTokens,
      usage: { include: true },
      provider: { data_collection: 'deny', zdr: true },
      ...(model.supportsThinking ? { reasoning: options.thinking ? { effort: 'medium' } : { effort: 'minimal', exclude: true } } : {}),
    }),
  });
  if (!response.ok || !response.body) {
    throw new UpstreamError(response.status, (await response.text().catch(() => '')).slice(0, 300));
  }

  const usage: StreamUsage = { promptTokens: 0, completionTokens: 0, costUsd: null };
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line.startsWith('data:')) continue; // comments / keep-alives
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      let chunk: {
        error?: { message?: string; code?: number };
        choices?: { delta?: { content?: string | null; reasoning?: string | null } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
      };
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }
      if (chunk.error) throw new UpstreamError(chunk.error.code ?? 502, chunk.error.message ?? 'upstream_error');
      const delta = chunk.choices?.[0]?.delta;
      if (delta?.content || delta?.reasoning) {
        options.onDelta({ content: delta.content ?? undefined, reasoning: delta.reasoning ?? undefined });
      }
      if (chunk.usage) {
        usage.promptTokens = chunk.usage.prompt_tokens ?? usage.promptTokens;
        usage.completionTokens = chunk.usage.completion_tokens ?? usage.completionTokens;
        if (typeof chunk.usage.cost === 'number') usage.costUsd = chunk.usage.cost;
      }
    }
  }
  return usage;
}

/** Sandbox stand-in: streams a test reply so the whole flow works offline. */
async function standIn(
  model: CloudModel,
  messages: ChatMessage[],
  options: { maxTokens: number; thinking: boolean; signal: AbortSignal; onDelta: (delta: StreamDelta) => void },
): Promise<StreamUsage> {
  const question = [...messages].reverse().find(m => m.role === 'user')?.content ?? '';
  const reply = `This is a **sandbox test reply** from the stand-in for ${model.name}. Add an OpenRouter API key to get real answers.\n\nYou asked: “${question.slice(0, 120)}”`;
  if (options.thinking) options.onDelta({ reasoning: 'Thinking about the question (sandbox stand-in).' });
  const words = reply.split(/(?<= )/);
  for (const word of words.slice(0, options.maxTokens)) {
    if (options.signal.aborted) break;
    await new Promise(resolve => setTimeout(resolve, 15));
    options.onDelta({ content: word });
  }
  const promptChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  return { promptTokens: Math.ceil(promptChars / 3.5), completionTokens: words.length, costUsd: null };
}
