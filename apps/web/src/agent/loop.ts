import { describeDone, describeRunning } from './describe';
import type { AgentMessage, AgentStep, StepReply, ToolCall, ToolResult } from './types';

/**
 * The coding agent's loop: ask the model what to do, do it with the desktop app's
 * tools, tell the model what happened, and go round again until it has nothing
 * more to do. Everything outside this file (the server, the tools, the screen) is
 * handed in, so the loop is tested with stand-ins for all three.
 */

export const MAX_STEPS = 40;
/** Past this many characters of conversation, the oldest tool output is dropped from what's sent. */
export const CONTEXT_CHARS = 450_000;
const KEEP_RECENT_RESULTS = 6;
const LEFT_OUT = '[Earlier output left out to save space. Read the file or run the command again if you need it.]';

export interface AgentDeps {
  /** One request to the model. `onText` gets its words as they arrive. */
  askModel: (messages: AgentMessage[], onText: (text: string) => void) => Promise<StepReply>;
  /** Runs a tool in the desktop app. Never throws: failures come back as { ok: false }. */
  runTool: (name: string, args: Record<string, unknown>) => Promise<ToolResult>;
  /** Called whenever there's something new to show. */
  onUpdate: (state: { steps: AgentStep[]; text: string }) => void;
  signal: AbortSignal;
  maxSteps?: number;
}

export interface AgentOutcome {
  steps: AgentStep[];
  /** The model's final answer. */
  text: string;
  charged: number;
  balance: number | null;
  stopped: boolean;
  /** Hit the step limit before the model was done. */
  limited: boolean;
}

/** Drops the oldest tool output (keeping the calls) once the conversation is long, so it keeps fitting. */
export function trimToolOutput(messages: AgentMessage[], limit = CONTEXT_CHARS): AgentMessage[] {
  const size = (m: AgentMessage) => m.content.length + (m.role === 'assistant' ? (m.tool_calls ?? []).reduce((sum, call) => sum + call.function.arguments.length, 0) : 0);
  let total = messages.reduce((sum, m) => sum + size(m), 0);
  if (total <= limit) return messages;
  const results = messages.map((m, index) => (m.role === 'tool' ? index : -1)).filter(index => index >= 0);
  const droppable = new Set(results.slice(0, Math.max(0, results.length - KEEP_RECENT_RESULTS)));
  return messages.map((m, index) => {
    if (total <= limit || !droppable.has(index) || m.role !== 'tool' || m.content === LEFT_OUT) return m;
    total -= m.content.length - LEFT_OUT.length;
    return { ...m, content: LEFT_OUT };
  });
}

/** Tool arguments as an object, or null if the model sent something that isn't one. */
export function parseArguments(raw: string): Record<string, unknown> | null {
  try {
    const value = raw.trim() ? JSON.parse(raw) : {};
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/** Runs one turn of the agent on top of the conversation so far (which ends with the user's message). */
export async function runAgent(history: AgentMessage[], deps: AgentDeps): Promise<AgentOutcome> {
  const maxSteps = deps.maxSteps ?? MAX_STEPS;
  const messages = [...history];
  const steps: AgentStep[] = [];
  const outcome: AgentOutcome = { steps, text: '', charged: 0, balance: null, stopped: false, limited: false };
  const show = (text = '') => deps.onUpdate({ steps: steps.map(step => ({ ...step })), text });

  for (let round = 0; ; round++) {
    if (deps.signal.aborted) return { ...outcome, stopped: true };
    if (round >= maxSteps) return { ...outcome, limited: true, text: `I stopped after ${maxSteps} steps. Tell me to carry on if you’d like me to continue.` };

    let reply: StepReply;
    try {
      reply = await deps.askModel([...trimToolOutput(messages)], text => show(text));
    } catch (error) {
      if (deps.signal.aborted) return { ...outcome, stopped: true };
      throw error;
    }
    outcome.charged = Math.round((outcome.charged + reply.charged) * 100) / 100;
    outcome.balance = reply.balance ?? outcome.balance;
    if (deps.signal.aborted) return { ...outcome, stopped: true, text: reply.content };

    if (reply.toolCalls.length === 0) {
      show(reply.content);
      return { ...outcome, text: reply.content };
    }

    // The echo of what the model asked for must carry valid JSON arguments, or the next request is refused.
    const calls: ToolCall[] = reply.toolCalls.map(call => ({ ...call, arguments: parseArguments(call.arguments) ? call.arguments || '{}' : '{}' }));
    messages.push({ role: 'assistant', content: reply.content, tool_calls: calls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } })) });

    for (const [index, call] of reply.toolCalls.entries()) {
      const args = parseArguments(call.arguments);
      const step: AgentStep = { id: call.id, tool: call.name, status: 'running', title: describeRunning(call.name, args ?? {}), ...(index === 0 && reply.content.trim() ? { text: reply.content.trim() } : {}) };
      steps.push(step);
      show();
      const result: ToolResult = args === null
        ? { ok: false, text: 'The arguments weren’t valid JSON. Send them again as a JSON object.' }
        : deps.signal.aborted ? { ok: false, text: 'Stopped by the user.', display: { kind: 'error' } } : await deps.runTool(call.name, args);
      Object.assign(step, describeDone(call.name, args ?? {}, result));
      if (deps.signal.aborted) step.status = 'stopped';
      messages.push({ role: 'tool', tool_call_id: call.id, content: result.text });
      show();
      if (deps.signal.aborted) return { ...outcome, stopped: true };
    }
  }
}
