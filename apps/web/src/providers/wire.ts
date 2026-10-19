/** What every provider adapter takes and gives, in one shape (OpenAI's, which the agent loop already uses). */

export interface WireToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type WireMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; tool_calls?: WireToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface WireTool {
  type: 'function';
  function: { name: string; description: string; parameters: object };
}

export interface ChatRequest {
  /** The provider's own model name. */
  model: string;
  messages: WireMessage[];
  tools?: WireTool[];
  maxTokens: number;
  signal?: AbortSignal;
  /** More fields for an OpenAI-style server, such as sampling settings for a model on this computer. They never replace the ones above. */
  extra?: Record<string, unknown>;
  /** Let the provider search the web itself (Anthropic's search tool). */
  webSearch?: boolean;
  /** Tools the provider runs itself (OpenRouter's search tool), offered next to any of ours; OpenAI format only. */
  serverTools?: Record<string, unknown>[];
}

export interface ChatReply {
  content: string;
  reasoning: string;
  toolCalls: { id: string; name: string; arguments: string }[];
  /** `stop`, `tool_calls` or `length` (or null if the provider didn't say). */
  finish: string | null;
  usage: { input: number; output: number } | null;
}

export interface Streamed {
  content: string;
  reasoning: string;
}

/** One provider wire format: how to ask, and how to read the streamed answer. */
export interface Adapter {
  path: string;
  body(request: ChatRequest, usage: boolean): unknown;
  read(stream: ReadableStream<Uint8Array>, emit: (partial: Streamed) => void): Promise<ChatReply>;
}
