/** One thing the coding agent did (or is doing) during a reply, as the chat shows it. */
export interface AgentStep {
  id: string;
  tool: string;
  /** What happened, in a line: "Read src/app.ts (lines 1-80)". */
  title: string;
  status: 'running' | 'done' | 'failed' | 'declined' | 'stopped';
  /** What the model said just before doing this. */
  text?: string;
  /** More to show when the step is opened: a diff, or a command's output. */
  detail?: { kind: 'diff' | 'output'; body: string };
}

/** What a tool gave back (apps/desktop/src/agent/session.js). */
export interface ToolResult {
  ok: boolean;
  /** What the model is told. */
  text: string;
  /** A little structure for the chat view. */
  display?: Record<string, unknown> & { kind?: string };
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

/** The conversation as the server takes it for Code mode. */
export type AgentMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface StepReply {
  content: string;
  toolCalls: ToolCall[];
  finish: string | null;
  charged: number;
  balance: number | null;
  /** Tokens used, when the provider says (models reached with the user's own key). */
  usage?: { input: number; output: number } | null;
}
