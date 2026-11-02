import type { MessageContent } from '../../shared/content';
import type { ThinkChoice } from '../../shared/thinking';
import type { WebSource } from '../../shared/webSources';

/** What every provider adapter takes and gives, in one shape (OpenAI's, which the agent loop already uses). */

export interface WireToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type WireMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: MessageContent }
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
  /** The person's Thinking choice, for a provider that can take it (Claude Agent); the others leave it out. */
  effort?: ThinkChoice;
  /** A side call (notes on a long chat): Claude Agent answers it in a process of its own that stops after. */
  oneOff?: boolean;
}

export interface ChatReply {
  content: string;
  reasoning: string;
  toolCalls: { id: string; name: string; arguments: string }[];
  /** `stop`, `tool_calls` or `length` (or null if the provider didn't say). */
  finish: string | null;
  usage: { input: number; output: number } | null;
  /** Pages the provider's own web search drew on (OpenRouter's search tool, Anthropic's). */
  sources?: WebSource[];
  /** Something to tell the person about their account, such as a plan limit coming up (Claude Agent). */
  notice?: string;
  /** The exact model that answered, as the provider reported it ("claude-sonnet-5-5" for Claude Code's "sonnet"). */
  model?: string;
  /** How much of the person's plan is used, when the provider says (Claude Agent on a Claude plan). */
  plan?: PlanUsage;
}

/** A Claude plan's usage windows ("five_hour", "seven_day", per-model weekly ones): share used, and when each resets. */
export interface PlanUsage {
  status: string | null;
  windows: { id: string; used: number; resetsAt: number | null }[];
  /** Extra usage beyond the plan: off, available, or being used now. */
  extra: 'off' | 'available' | 'in_use' | null;
}

export interface Streamed {
  content: string;
  reasoning: string;
  /** Searches the provider has run so far for this reply, by their words ('' until they are known). */
  searches?: string[];
}

/** One provider wire format: how to ask, and how to read the streamed answer. */
export interface Adapter {
  path: string;
  body(request: ChatRequest, usage: boolean): unknown;
  read(stream: ReadableStream<Uint8Array>, emit: (partial: Streamed) => void): Promise<ChatReply>;
}
