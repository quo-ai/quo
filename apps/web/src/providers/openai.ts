import { ProviderError } from './errors';
import { sseEvents } from './sse';
import type { Adapter, ChatReply, ChatRequest, WireMessage } from './wire';

/** OpenAI's chat completions format, which most providers (and local servers) copy. */

const toApi = (message: WireMessage) => (message.role === 'assistant' && message.tool_calls?.length ? { ...message, content: message.content || null } : message);

interface Chunk {
  choices?: { delta?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: unknown } }[] }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
  error?: { message?: unknown } | string;
}

export const openai: Adapter = {
  path: '/chat/completions',

  body(request: ChatRequest, usage: boolean) {
    // Extra settings can add to the request, never change what it is.
    const { model: _m, messages: _msgs, stream: _s, tools: _t, tool_choice: _c, stream_options: _o, ...extra } = request.extra ?? {};
    return {
      ...extra,
      model: request.model,
      messages: request.messages.map(toApi),
      stream: true,
      ...(usage ? { stream_options: { include_usage: true } } : {}),
      ...(request.tools?.length || request.serverTools?.length ? { tools: [...(request.tools ?? []), ...(request.serverTools ?? [])], tool_choice: 'auto' } : {}),
    };
  },

  async read(stream, emit): Promise<ChatReply> {
    const reply: ChatReply = { content: '', reasoning: '', toolCalls: [], finish: null, usage: null };
    const calls: { id: string; name: string; arguments: string }[] = [];
    for await (const { data } of sseEvents(stream)) {
      if (data.trim() === '[DONE]') break;
      let chunk: Chunk;
      try {
        chunk = JSON.parse(data) as Chunk;
      } catch {
        continue;
      }
      if (chunk.error) {
        const message = typeof chunk.error === 'string' ? chunk.error : chunk.error.message;
        throw new ProviderError(502, 'provider_failed', `The provider stopped the reply: ${typeof message === 'string' ? message.slice(0, 200) : 'unknown error'}`, '');
      }
      if (chunk.usage) reply.usage = { input: chunk.usage.prompt_tokens ?? 0, output: chunk.usage.completion_tokens ?? 0 };
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta ?? {};
      if (typeof delta.content === 'string' && delta.content) reply.content += delta.content;
      const thought = delta.reasoning_content ?? delta.reasoning;
      if (typeof thought === 'string' && thought) reply.reasoning += thought;
      for (const part of delta.tool_calls ?? []) {
        // `index` says which call a piece belongs to; a server that leaves it out starts a call with an id and continues it without one.
        const at = part.index ?? (part.id ? calls.length : Math.max(0, calls.length - 1));
        const slot = (calls[at] ??= { id: '', name: '', arguments: '' });
        if (part.id) slot.id = part.id;
        if (part.function?.name) slot.name += part.function.name;
        const args = part.function?.arguments;
        if (typeof args === 'string') slot.arguments += args;
        else if (args && typeof args === 'object') slot.arguments = JSON.stringify(args);
      }
      if (choice.finish_reason) reply.finish = choice.finish_reason === 'tool_calls' || choice.finish_reason === 'function_call' ? 'tool_calls' : choice.finish_reason;
      emit({ content: reply.content, reasoning: reply.reasoning });
    }
    reply.toolCalls = calls.filter(call => call.name).map((call, index) => ({ ...call, id: call.id || `call_${index + 1}` }));
    if (reply.toolCalls.length && reply.finish !== 'tool_calls') reply.finish = 'tool_calls';
    return reply;
  },
};
