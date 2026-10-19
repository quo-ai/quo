import { READ_ONLY_TOOLS } from '../../shared/agentTools';
import { runAgent, type AgentDeps } from './loop';
import type { StepReply, ToolResult } from './types';

/**
 * The task tool: a helper that reads the project on its own and reports back, so the main conversation doesn't fill up
 * with the dozens of reads a broad question takes. It is a second run of the same loop with three limits: it gets only
 * the reading tools (the server also hands it only those, whatever the app asks), it starts with none of the main
 * conversation, and it can't start helpers of its own. What comes back is its final report, as plain text.
 */

export const TASK_TOOL = 'task';
export const SUBAGENT_STEPS = 15;
const MAX_PROMPT = 4000;
const MAX_REPORT = 6000;

export interface SubagentDeps {
  /** One request to the model as the helper (read-only role). */
  askModel: AgentDeps['askModel'];
  /** Runs one of the desktop app's reading tools. */
  runTool: AgentDeps['runTool'];
  signal: AbortSignal;
  contextChars?: number;
  /** Told what the helper's steps cost, so the turn's total includes them. */
  onCost?: (charged: number) => void;
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

export async function runSubagent(args: Record<string, unknown>, deps: SubagentDeps): Promise<ToolResult> {
  const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : '';
  const description = clip((typeof args.description === 'string' ? args.description : '').replace(/\s+/g, ' ').trim() || 'investigation', 80);
  if (!prompt) return { ok: false, text: 'task needs a prompt: the full question for the helper.', display: { kind: 'error' } };
  if (prompt.length > MAX_PROMPT) return { ok: false, text: `That prompt is too long (at most ${MAX_PROMPT} characters). Ask one focused question.`, display: { kind: 'error' } };

  const outcome = await runAgent([{ role: 'user', content: prompt }], {
    signal: deps.signal,
    maxSteps: SUBAGENT_STEPS,
    contextChars: deps.contextChars,
    askModel: async (messages, onText): Promise<StepReply> => {
      const reply = await deps.askModel(messages, onText);
      if (reply.charged) deps.onCost?.(reply.charged);
      return reply;
    },
    // Only the reading tools, checked here as well as on the server.
    runTool: (name, toolArgs) =>
      (READ_ONLY_TOOLS as string[]).includes(name)
        ? deps.runTool(name, toolArgs)
        : Promise.resolve({ ok: false, text: `The helper can't use ${name}. It can only read.`, display: { kind: 'error' } }),
    onUpdate: () => {},
  });

  const report = outcome.text.trim();
  const reads = outcome.steps.length;
  if (outcome.stopped) return { ok: false, text: 'Stopped by the user.', display: { kind: 'error' } };
  // When it hit its step limit the loop's own words are for a person, not for the agent that asked.
  const text = clip(outcome.limited ? 'The helper ran out of steps without a report. Ask a narrower question, or look yourself.' : report || 'The helper found nothing to report.', MAX_REPORT);
  return { ok: true, text, display: { kind: 'task', description, steps: reads, report: text } };
}
