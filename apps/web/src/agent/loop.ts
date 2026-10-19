import { describeDone, describeRunning } from './describe';
import { READ_ONLY_TOOLS } from '../../shared/agentTools';
import type { AgentMessage, AgentStep, StepReply, ToolCall, ToolResult } from './types';

/**
 * The coding agent's loop: ask the model what to do, do it with the desktop app's
 * tools, tell the model what happened, and go round again until it has nothing
 * more to do. Everything outside this file (the server, the tools, the screen) is
 * handed in, so the loop is tested with stand-ins for all three.
 */

export const MAX_STEPS = 40;
/** Tools that only look, so several in one reply can run at once. */
const PARALLEL_TOOLS = new Set(READ_ONLY_TOOLS);
/** Past this many characters of conversation, the oldest tool output is dropped from what's sent. */
export const CONTEXT_CHARS = 450_000;
// A model that keeps making the same call, or keeps failing, isn't getting anywhere. Small models especially can loop.
const REPEATS_ALLOWED = 2;
const FAILURES_ALLOWED = 5;
const REPEATED = 'You have already made this exact call twice with the same result. Do not repeat it. Use what you have, try something different, or tell the user what is blocking you.';
const ALWAYS_KEEP = 1; // the newest tool result is what the model is about to read; it is never dropped
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
  /** How much conversation to send before old tool output is dropped, for a model with a smaller window. */
  contextChars?: number;
  /** How many tokens the conversation is about to take (counted by the provider after a reply, when it says; otherwise estimated). */
  onContext?: (tokens: number, exact: boolean) => void;
}

export interface AgentOutcome {
  steps: AgentStep[];
  /** The model's final answer. */
  text: string;
  charged: number;
  balance: number | null;
  /** Tokens used over the whole turn, when the provider says (the user's own key). */
  usage: { input: number; output: number } | null;
  stopped: boolean;
  /** Hit the step limit before the model was done. */
  limited: boolean;
}

/** Drops the oldest tool output first (keeping the calls) once the conversation is long, so it keeps fitting. Newer output survives as long as it fits. */
export function trimToolOutput(messages: AgentMessage[], limit = CONTEXT_CHARS): AgentMessage[] {
  const size = (m: AgentMessage) => m.content.length + (m.role === 'assistant' ? (m.tool_calls ?? []).reduce((sum, call) => sum + call.function.arguments.length, 0) : 0);
  let total = messages.reduce((sum, m) => sum + size(m), 0);
  if (total <= limit) return messages;
  const results = messages.map((m, index) => (m.role === 'tool' ? index : -1)).filter(index => index >= 0);
  const droppable = new Set(results.slice(0, Math.max(0, results.length - ALWAYS_KEEP)));
  return messages.map((m, index) => {
    if (total <= limit || !droppable.has(index) || m.role !== 'tool' || m.content === LEFT_OUT) return m;
    total -= m.content.length - LEFT_OUT.length;
    return { ...m, content: LEFT_OUT };
  });
}

/** How many files the agent changed (created, edited or replaced) in these steps. */
export function countChanges(steps: AgentStep[]): number {
  return steps.filter(step => (step.tool === 'edit_file' || step.tool === 'write_file') && step.status === 'done').length;
}

/** About how many tokens a conversation takes (3.5 characters to a token, the same rough count as the rest of the app). */
export function estimateTokens(messages: AgentMessage[]): number {
  const chars = messages.reduce((sum, m) => sum + m.content.length + (m.role === 'assistant' ? (m.tool_calls ?? []).reduce((total, call) => total + call.function.arguments.length + call.function.name.length, 0) : 0), 0);
  return Math.ceil(chars / 3.5) + 6 * messages.length;
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
  const outcome: AgentOutcome = { steps, text: '', charged: 0, balance: null, usage: null, stopped: false, limited: false };
  const show = (text = '') => deps.onUpdate({ steps: steps.map(step => ({ ...step })), text });
  let previous = '';
  let repeats = 0;
  let failures = 0;

  for (let round = 0; ; round++) {
    if (deps.signal.aborted) return { ...outcome, stopped: true };
    if (round >= maxSteps) return { ...outcome, limited: true, text: `I stopped after ${maxSteps} steps. Tell me to carry on if you’d like me to continue.` };

    let reply: StepReply;
    try {
      const sent = trimToolOutput(messages, deps.contextChars);
      deps.onContext?.(estimateTokens(sent), false);
      reply = await deps.askModel([...sent], text => show(text));
    } catch (error) {
      if (deps.signal.aborted) return { ...outcome, stopped: true };
      throw error;
    }
    outcome.charged = Math.round((outcome.charged + reply.charged) * 100) / 100;
    outcome.balance = reply.balance ?? outcome.balance;
    if (reply.usage?.input) deps.onContext?.(reply.usage.input + reply.usage.output, true);
    if (reply.usage) outcome.usage = { input: (outcome.usage?.input ?? 0) + reply.usage.input, output: (outcome.usage?.output ?? 0) + reply.usage.output };
    if (deps.signal.aborted) return { ...outcome, stopped: true, text: reply.content };

    if (reply.toolCalls.length === 0) {
      show(reply.content);
      return { ...outcome, text: reply.content };
    }

    // The echo of what the model asked for must carry valid JSON arguments, or the next request is refused.
    const calls: ToolCall[] = reply.toolCalls.map(call => ({ ...call, arguments: parseArguments(call.arguments) ? call.arguments || '{}' : '{}' }));
    messages.push({ role: 'assistant', content: reply.content, tool_calls: calls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } })) });

    // Reading tools that come together in one reply start together and are answered in order; anything that changes
    // something waits for the reads before it to finish (an edit needs the read that came first).
    const pending: { call: (typeof reply.toolCalls)[number]; step: AgentStep; args: Record<string, unknown>; promise: Promise<ToolResult> }[] = [];
    const record = (call: (typeof reply.toolCalls)[number], step: AgentStep, args: Record<string, unknown> | null, result: ToolResult) => {
      // A change or command the person declined is their choice, not the model failing.
      failures = result.ok || result.display?.denied ? 0 : failures + 1;
      Object.assign(step, describeDone(call.name, args ?? {}, result));
      if (deps.signal.aborted) step.status = 'stopped';
      messages.push({ role: 'tool', tool_call_id: call.id, content: result.text });
      show();
    };
    const flush = async (): Promise<boolean> => {
      for (const item of pending.splice(0)) record(item.call, item.step, item.args, await item.promise);
      return deps.signal.aborted;
    };

    for (const [index, call] of reply.toolCalls.entries()) {
      const args = parseArguments(call.arguments);
      const step: AgentStep = { id: call.id, tool: call.name, status: 'running', title: describeRunning(call.name, args ?? {}), ...(index === 0 && reply.content.trim() ? { text: reply.content.trim() } : {}) };
      steps.push(step);
      show();
      const sameAsBefore = args !== null && `${call.name} ${JSON.stringify(args)}` === previous;
      repeats = sameAsBefore ? repeats + 1 : 0;
      if (args !== null) previous = `${call.name} ${JSON.stringify(args)}`;
      const refused: ToolResult | null = args === null
        ? { ok: false, text: 'The arguments weren’t valid JSON. Send them again as a JSON object.' }
        : deps.signal.aborted ? { ok: false, text: 'Stopped by the user.', display: { kind: 'error' } }
          : repeats >= REPEATS_ALLOWED ? { ok: false, text: REPEATED, display: { kind: 'error' } } : null;
      if (args !== null && !refused && PARALLEL_TOOLS.has(call.name)) {
        pending.push({ call, step, args, promise: deps.runTool(call.name, args) });
        continue;
      }
      if (await flush()) {
        step.status = 'stopped';
        show();
        return { ...outcome, stopped: true };
      }
      record(call, step, args, refused ?? await deps.runTool(call.name, args as Record<string, unknown>));
      if (deps.signal.aborted) return { ...outcome, stopped: true };
    }
    if (await flush()) return { ...outcome, stopped: true };
    if (failures >= FAILURES_ALLOWED) return { ...outcome, limited: true, text: 'I kept running into errors, so I stopped. Tell me how you’d like to go on, or try a more capable model.' };
  }
}
