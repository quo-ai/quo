import { config } from './env.js';
import type { CloudModel } from './cloudModels.js';

/**
 * Streams a chat completion from OpenRouter (OpenAI-compatible SSE).
 * Requests only providers that don't collect or retain data. Without an
 * API key (sandbox) a stand-in model streams a labelled test reply.
 */

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface StreamDelta {
  content?: string;
  reasoning?: string;
}

export interface StreamUsage {
  promptTokens: number;
  completionTokens: number;
  /** USD, as reported by OpenRouter; null for the stand-in. */
  costUsd: number | null;
  /** Tools the model asked to use (Code mode); empty for an ordinary reply. */
  toolCalls: ToolCall[];
  finishReason: string | null;
}

export interface StreamOptions {
  maxTokens: number;
  thinking: boolean;
  signal: AbortSignal;
  onDelta: (delta: StreamDelta) => void;
  /** Code mode: the tools the model may call (OpenAI function format). */
  tools?: unknown[];
}

export class UpstreamError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function streamChat(
  model: CloudModel,
  messages: ChatMessage[],
  options: StreamOptions,
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
      // An assistant turn that only called tools has no text; the API wants null, not "".
      messages: messages.map(m => (m.role === 'assistant' && m.tool_calls?.length && !m.content ? { ...m, content: null } : m)),
      ...(options.tools?.length ? { tools: options.tools, tool_choice: 'auto' } : {}),
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

  const usage: StreamUsage = { promptTokens: 0, completionTokens: 0, costUsd: null, toolCalls: [], finishReason: null };
  const calls = new Map<number, ToolCall>();
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
        choices?: {
          delta?: {
            content?: string | null;
            reasoning?: string | null;
            tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[];
          };
          finish_reason?: string | null;
        }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
      };
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }
      if (chunk.error) throw new UpstreamError(chunk.error.code ?? 502, chunk.error.message ?? 'upstream_error');
      const choice = chunk.choices?.[0];
      const delta = choice?.delta;
      if (delta?.content || delta?.reasoning) {
        options.onDelta({ content: delta.content ?? undefined, reasoning: delta.reasoning ?? undefined });
      }
      // A tool call arrives in pieces: the id and name first, then the arguments a bit at a time.
      for (const piece of delta?.tool_calls ?? []) {
        const index = piece.index ?? 0;
        const call = calls.get(index) ?? { id: '', type: 'function' as const, function: { name: '', arguments: '' } };
        if (piece.id) call.id = piece.id;
        if (piece.function?.name) call.function.name += piece.function.name;
        if (piece.function?.arguments) call.function.arguments += piece.function.arguments;
        calls.set(index, call);
      }
      if (choice?.finish_reason) usage.finishReason = choice.finish_reason;
      if (chunk.usage) {
        usage.promptTokens = chunk.usage.prompt_tokens ?? usage.promptTokens;
        usage.completionTokens = chunk.usage.completion_tokens ?? usage.completionTokens;
        if (typeof chunk.usage.cost === 'number') usage.costUsd = chunk.usage.cost;
      }
    }
  }
  usage.toolCalls = [...calls.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, call]) => ({ ...call, id: call.id || `call_${index}` }))
    .filter(call => call.function.name);
  return usage;
}

/** Sandbox stand-in: streams a test reply so the whole flow works offline. */
async function standIn(model: CloudModel, messages: ChatMessage[], options: StreamOptions): Promise<StreamUsage> {
  if (options.tools?.length) return standInAgent(model, messages, options);
  const question = [...messages].reverse().find(m => m.role === 'user')?.content ?? '';
  const reply = `This is a **sandbox test reply** from the stand-in for ${model.name}. Add an OpenRouter API key to get real answers.\n\nYou asked: “${question.slice(0, 120)}”`;
  if (options.thinking) options.onDelta({ reasoning: 'Thinking about the question (sandbox stand-in).' });
  await streamWords(reply, options);
  const promptChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  return { promptTokens: Math.ceil(promptChars / 3.5), completionTokens: reply.split(/(?<= )/).length, costUsd: null, toolCalls: [], finishReason: 'stop' };
}

async function streamWords(text: string, options: StreamOptions): Promise<void> {
  for (const word of text.split(/(?<= )/).slice(0, options.maxTokens)) {
    if (options.signal.aborted) break;
    await new Promise(resolve => setTimeout(resolve, 10));
    options.onDelta({ content: word });
  }
}

/**
 * Sandbox stand-in for Code mode, scripted so every part of the loop can be tried without a key:
 * it looks at the project folder, and if asked to create a file or run something, does that (the
 * user still approves each). "create a file" → write_file; "run" / "test" → run_command.
 */
async function standInAgent(model: CloudModel, messages: ChatMessage[], options: StreamOptions): Promise<StreamUsage> {
  const lastUser = [...messages].reverse().findIndex(m => m.role === 'user');
  const turn = lastUser === -1 ? messages : messages.slice(messages.length - 1 - lastUser);
  const task = turn[0]?.role === 'user' ? turn[0].content : '';
  const results = turn.filter(m => m.role === 'tool').length;
  const promptTokens = Math.ceil(messages.reduce((sum, m) => sum + m.content.length, 0) / 3.5);
  const call = (name: string, args: unknown): ToolCall => ({ id: `call_${results + 1}`, type: 'function', function: { name, arguments: JSON.stringify(args) } });
  const say = async (text: string, toolCalls: ToolCall[] = []): Promise<StreamUsage> => {
    await streamWords(text, options);
    return { promptTokens, completionTokens: Math.ceil(text.length / 3.5), costUsd: null, toolCalls, finishReason: toolCalls.length ? 'tool_calls' : 'stop' };
  };
  const label = `(sandbox stand-in for ${model.name})`;

  if (results === 0) {
    if (/\bcreate\b.*\bfile\b/i.test(task)) return say(`I'll create a small file. ${label}\n`, [call('write_file', { path: 'quo-sandbox.txt', content: 'Hello from the Code mode sandbox stand-in.\n' })]);
    if (/\b(run|test)\b/i.test(task)) return say(`I'll run a command. ${label}\n`, [call('run_command', { command: 'echo hello from the sandbox' })]);
    return say(`I'll start by looking at the project. ${label}\n`, [call('list_directory', {})]);
  }
  const last = messages[messages.length - 1];
  const seen = last.role === 'tool' ? last.content.slice(0, 600) : '';
  return say(`Done. This is what I saw:\n\n${seen}\n\nThis is a **sandbox test reply**: add an OpenRouter API key for a real coding agent.`);
}
