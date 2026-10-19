import { addSource, pickSources, type WebSource } from '../../shared/webSources';
import { describeDone, describeRunning } from './describe';
import { READ_ONLY_TOOLS } from '../../shared/agentTools';
import { previousReport, originalGoal, splitForSummary, transcriptOf, withSummary } from './summarize';
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
const LEFT_OUT_START = '[Earlier output left out';

export interface AgentDeps {
  /** One request to the model. `onText` gets its words as they arrive. */
  askModel: (messages: AgentMessage[], onText: (text: string) => void) => Promise<StepReply>;
  /** Runs a tool in the desktop app. Never throws: failures come back as { ok: false }. */
  runTool: (name: string, args: Record<string, unknown>) => Promise<ToolResult>;
  /** Called whenever there's something new to show. */
  onUpdate: (state: { steps: AgentStep[]; text: string }) => void;
  signal: AbortSignal;
  maxSteps?: number;
  /**
   * Writes the given steps up as a short report (a plain request to the model with no tools). When it is given, a long
   * conversation is summarised before old output is dropped. A failure is not an error: the old output is dropped instead.
   */
  summarize?: (transcript: string) => Promise<string>;
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
  /** Web pages the reply drew on (see pickSources). */
  sources: WebSource[];
}

/** What a dropped result was the answer to, in a few words: "read_file {"path":"src/app.ts"}". */
function describeCall(messages: AgentMessage[], id: string): string {
  for (const m of messages) {
    const call = m.role === 'assistant' ? m.tool_calls?.find(c => c.id === id) : undefined;
    if (call) {
      const args = call.function.arguments.replace(/\s+/g, ' ');
      return `${call.function.name} ${args.length > 100 ? `${args.slice(0, 100)}…` : args}`.trim();
    }
  }
  return '';
}

/**
 * Drops the oldest tool output first (keeping the calls) once the conversation is long, so it keeps fitting. Newer output
 * survives as long as it fits. A dropped result says which call it was, so the model still knows what it has already looked at.
 */
export function trimToolOutput(messages: AgentMessage[], limit = CONTEXT_CHARS): AgentMessage[] {
  const size = (m: AgentMessage) => m.content.length + (m.role === 'assistant' ? (m.tool_calls ?? []).reduce((sum, call) => sum + call.function.arguments.length, 0) : 0);
  let total = messages.reduce((sum, m) => sum + size(m), 0);
  if (total <= limit) return messages;
  const results = messages.map((m, index) => (m.role === 'tool' ? index : -1)).filter(index => index >= 0);
  const droppable = new Set(results.slice(0, Math.max(0, results.length - ALWAYS_KEEP)));
  return messages.map((m, index) => {
    if (total <= limit || !droppable.has(index) || m.role !== 'tool' || m.content.startsWith(LEFT_OUT_START)) return m;
    const call = describeCall(messages, m.tool_call_id);
    const note = `${LEFT_OUT_START} to save space${call ? ` (${call})` : ''}. Run it again if you need it.]`;
    total -= Math.max(0, m.content.length - note.length);
    return { ...m, content: note };
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

const SUMMARY_AT = 0.7; // of the window
const SUMMARY_RETRY_ROUNDS = 4;

const sizeOf = (messages: AgentMessage[]) => messages.reduce((sum, m) => sum + m.content.length + (m.role === 'assistant' ? (m.tool_calls ?? []).reduce((total, call) => total + call.function.arguments.length, 0) : 0), 0);

/** The conversation with its middle written up, when it is long enough to need it; null when it isn't, or the report failed. */
async function condense(messages: AgentMessage[], deps: AgentDeps, steps: AgentStep[], show: () => void): Promise<AgentMessage[] | null> {
  if (sizeOf(messages) < (deps.contextChars ?? CONTEXT_CHARS) * SUMMARY_AT) return null;
  const split = splitForSummary(messages);
  const user = split ? messages[split.userIndex] : null;
  if (!split || !user || user.role !== 'user') return null;
  const step: AgentStep = { id: `summary-${steps.length}`, tool: 'summary', status: 'running', title: 'Summarising the earlier work to save space…' };
  steps.push(step);
  show();
  try {
    const report = (await deps.summarize!(transcriptOf(originalGoal(user.content), previousReport(user.content), split.middle))).trim();
    if (!report) throw new Error('empty');
    step.status = 'done';
    step.title = `Summarised ${split.middle.length} earlier messages to save space`;
    show();
    return withSummary(messages, split, report);
  } catch {
    if (deps.signal.aborted) throw new Error('aborted');
    step.status = 'failed';
    step.title = 'Couldn’t summarise the earlier work; dropping old output instead';
    show();
    return null;
  }
}

/** Runs one turn of the agent on top of the conversation so far (which ends with the user's message). */
export async function runAgent(history: AgentMessage[], deps: AgentDeps): Promise<AgentOutcome> {
  const maxSteps = deps.maxSteps ?? MAX_STEPS;
  const messages = [...history];
  const steps: AgentStep[] = [];
  const outcome: AgentOutcome = { steps, text: '', charged: 0, balance: null, usage: null, stopped: false, limited: false, sources: [] };
  // Pages the model read and results its searches found, for the sources under the reply.
  const read: WebSource[] = [];
  const found: WebSource[] = [];
  const show = (text = '') => deps.onUpdate({ steps: steps.map(step => ({ ...step })), text });
  let previous = '';
  let nextSummary = 0;
  let repeats = 0;
  let failures = 0;

  for (let round = 0; ; round++) {
    if (deps.signal.aborted) return { ...outcome, stopped: true };
    if (round >= maxSteps) return { ...outcome, limited: true, text: `I stopped after ${maxSteps} steps. Tell me to carry on if you’d like me to continue.` };

    let reply: StepReply;
    try {
      if (deps.summarize && round >= nextSummary) {
        const compacted = await condense(messages, deps, steps, show);
        if (compacted) messages.splice(0, messages.length, ...compacted);
        else nextSummary = round + SUMMARY_RETRY_ROUNDS;
      }
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
      return { ...outcome, text: reply.content, sources: pickSources(read, found, reply.content) };
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
      if (result.ok && result.display?.kind === 'fetch') addSource(read, result.display.url, result.display.title);
      if (result.ok && result.display?.kind === 'web_search' && Array.isArray(result.display.results)) for (const r of result.display.results as { url?: unknown; title?: unknown }[]) addSource(found, r?.url, r?.title);
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
      // Looking at a background command again and again is how you wait for it, not a loop.
      repeats = sameAsBefore && call.name !== 'command_output' ? repeats + 1 : 0;
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
