import type { MessageContent } from '../../shared/content';
import { ProviderError } from './errors';
import { sseEvents } from './sse';
import { addSource, queryOf, type WebSource } from '../../shared/webSources';
import type { Adapter, ChatReply, ChatRequest, WireMessage } from './wire';

/** Anthropic's messages format. */

type Block =
  | { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string }; cache_control?: { type: 'ephemeral' } }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; cache_control?: { type: 'ephemeral' } };
interface Turn {
  role: 'user' | 'assistant';
  content: Block[];
}

const inputOf = (raw: string): unknown => {
  try {
    const value = JSON.parse(raw || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
};

/** A user message's text and images as Anthropic's blocks (an image is a data address the app made: shared/content.ts). */
function userBlocks(content: MessageContent): Block[] {
  if (typeof content === 'string') return content.trim() ? [{ type: 'text', text: content }] : [];
  return content.flatMap((part): Block[] => {
    if (part.type === 'text') return part.text.trim() ? [{ type: 'text', text: part.text }] : [];
    const match = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/.exec(part.image_url.url);
    return match ? [{ type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } }] : [];
  });
}

/**
 * OpenAI-style messages as Anthropic wants them: the system prompt on its own, a model's tool calls as
 * `tool_use` blocks, and all the results that answer them together in the next user turn.
 */
export function convert(messages: WireMessage[]): { system: string; turns: Turn[] } {
  const system: string[] = [];
  const turns: Turn[] = [];
  const add = (role: Turn['role'], block: Block) => {
    const last = turns[turns.length - 1];
    if (last?.role === role) {
      // Results of tool calls must come first in the user turn that follows them.
      if (block.type === 'tool_result') last.content.splice(last.content.filter(b => b.type === 'tool_result').length, 0, block);
      else last.content.push(block);
    } else turns.push({ role, content: [block] });
  };
  for (const message of messages) {
    if (message.role === 'system') system.push(message.content);
    else if (message.role === 'user') {
      for (const block of userBlocks(message.content)) add('user', block);
    } else if (message.role === 'assistant') {
      if (message.content.trim()) add('assistant', { type: 'text', text: message.content });
      for (const call of message.tool_calls ?? []) add('assistant', { type: 'tool_use', id: call.id, name: call.function.name, input: inputOf(call.function.arguments) });
    } else add('user', { type: 'tool_result', tool_use_id: message.tool_call_id, content: message.content || '(no output)' });
  }
  return { system: system.join('\n\n'), turns };
}

interface Event {
  type?: string;
  message?: { usage?: Usage; model?: string };
  content_block?: { type?: string; id?: string; name?: string; content?: unknown };
  index?: number;
  delta?: { type?: string; text?: string; partial_json?: string; thinking?: string; stop_reason?: string; citation?: { url?: unknown; title?: unknown } };
  usage?: Usage;
  error?: { message?: string };
}
interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

const FINISH: Record<string, string> = { tool_use: 'tool_calls', end_turn: 'stop', stop_sequence: 'stop', max_tokens: 'length' };

export const anthropic: Adapter = {
  path: '/messages',

  body(request: ChatRequest) {
    const { system, turns } = convert(request.messages);
    // Marking the system prompt and the newest block lets Anthropic reuse the long, unchanged start of a conversation
    // at a fraction of the price: a coding session sends the same prefix every step.
    const last = turns[turns.length - 1]?.content.at(-1);
    if (last && last.type !== 'tool_use') last.cache_control = { type: 'ephemeral' };
    return {
      model: request.model,
      max_tokens: request.maxTokens,
      stream: true,
      ...(system ? { system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }] } : {}),
      messages: turns,
      ...(request.tools?.length || request.webSearch
        ? {
            tools: [
              ...(request.webSearch ? [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }] : []),
              ...(request.tools ?? []).map(tool => ({ name: tool.function.name, description: tool.function.description, input_schema: tool.function.parameters })),
            ],
            tool_choice: { type: 'auto' },
          }
        : {}),
    };
  },

  async read(stream, emit): Promise<ChatReply> {
    const reply: ChatReply = { content: '', reasoning: '', toolCalls: [], finish: null, usage: null };
    const sources: WebSource[] = [];
    const tools = new Map<number, { id: string; name: string; arguments: string }>();
    // Anthropic's own web search: the searches it runs (their words stream in like a tool's input) and the pages found.
    const searches: string[] = [];
    const searchAt = new Map<number, { at: number; input: string }>();
    const emitAll = () => emit({ content: reply.content, reasoning: reply.reasoning, ...(searches.length ? { searches: [...searches] } : {}) });
    let input = 0;
    let output = 0;
    const counted = (usage: Usage | undefined) => {
      if (!usage) return;
      if (usage.input_tokens !== undefined) input = usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
      if (usage.output_tokens !== undefined) output = usage.output_tokens;
    };
    for await (const { data } of sseEvents(stream)) {
      let event: Event;
      try {
        event = JSON.parse(data) as Event;
      } catch {
        continue;
      }
      switch (event.type) {
        case 'message_start':
          counted(event.message?.usage);
          if (typeof event.message?.model === 'string' && event.message.model) reply.model = event.message.model;
          break;
        case 'content_block_start':
          if (event.content_block?.type === 'tool_use' && event.index !== undefined) tools.set(event.index, { id: event.content_block.id ?? '', name: event.content_block.name ?? '', arguments: '' });
          else if (event.content_block?.type === 'server_tool_use' && event.content_block.name === 'web_search' && event.index !== undefined) {
            searchAt.set(event.index, { at: searches.length, input: '' });
            searches.push('');
            emitAll();
          } else if (event.content_block?.type === 'web_search_tool_result' && Array.isArray(event.content_block.content)) {
            for (const result of event.content_block.content as { type?: string; url?: unknown; title?: unknown }[]) if (result?.type === 'web_search_result') addSource(sources, result.url, result.title);
          }
          break;
        case 'content_block_delta': {
          const delta = event.delta;
          if (delta?.type === 'text_delta' && delta.text) reply.content += delta.text;
          else if (delta?.type === 'thinking_delta' && delta.thinking) reply.reasoning += delta.thinking;
          else if (delta?.type === 'input_json_delta' && event.index !== undefined) {
            const tool = tools.get(event.index);
            if (tool) tool.arguments += delta.partial_json ?? '';
            const search = searchAt.get(event.index);
            if (search) {
              search.input += delta.partial_json ?? '';
              const words = queryOf(search.input);
              if (words) searches[search.at] = words;
            }
          } else if (delta?.type === 'citations_delta' && delta.citation) addSource(sources, delta.citation.url, delta.citation.title);
          emitAll();
          break;
        }
        case 'message_delta':
          counted(event.usage);
          if (event.delta?.stop_reason) reply.finish = FINISH[event.delta.stop_reason] ?? event.delta.stop_reason;
          break;
        case 'error': throw new ProviderError(502, 'provider_failed', `The provider stopped the reply: ${(event.error?.message ?? 'unknown error').slice(0, 200)}`, '');
      }
    }
    reply.toolCalls = [...tools.entries()].sort(([a], [b]) => a - b).map(([, tool]) => ({ ...tool, arguments: tool.arguments || '{}' }));
    if (reply.toolCalls.length) reply.finish = 'tool_calls';
    reply.usage = input || output ? { input, output } : null;
    if (sources.length) reply.sources = sources;
    return reply;
  },
};
