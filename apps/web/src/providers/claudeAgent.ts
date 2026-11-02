import { CLAUDE_AGENT_NOTE } from '../../shared/prompts';
import type { ClaudeEffort, ThinkChoice } from '../../shared/thinking';
import { claudeBridge, unwrap, type ClaudeEvent, type ClaudeModel, type ClaudeStatus, type DesktopClaude } from '../native';
import { toast } from '../ui/Toasts';
import { noteUsage } from './claudeUsage';
import { ProviderError } from './errors';
import type { ListedModel } from './listing';
import type { ProviderInfo } from './registry';
import type { ChatReply, ChatRequest, Streamed, WireMessage } from './wire';

/**
 * Claude Agent (desktop app only): Claude models through the person's own Claude Code login, using Anthropic's Agent
 * SDK in the main process (apps/desktop/src/claude/). It works like a provider reached with a key: the same requests,
 * the same replies, the same Code mode tools and approvals. Quo never sees the login, and usage counts against the
 * person's Claude plan. "Claude Agent" is the name Anthropic's branding rules allow.
 */

export const CLAUDE_AGENT: ProviderInfo = { id: 'claude-agent', name: 'Claude Agent', protocol: 'claude-agent', baseUrl: '', usage: true };

export const isClaudeAgent = (provider: Pick<ProviderInfo, 'id'>): boolean => provider.id === CLAUDE_AGENT.id;


/** Whether Claude Code is on this computer; `check` also starts it to see the sign-in and the models (no message is sent). */
export async function claudeStatus(check: boolean, bridge: DesktopClaude | null = claudeBridge()): Promise<ClaudeStatus> {
  if (!bridge) return { installed: false };
  return unwrap(await bridge.status({ check }));
}

export async function listClaudeModels(bridge: DesktopClaude | null = claudeBridge()): Promise<ListedModel[]> {
  const status = await claudeStatus(true, bridge);
  if (!status.installed) throw new ProviderError(0, 'claude_missing', 'Claude Code isn’t installed on this computer.', CLAUDE_AGENT.id);
  if (status.problem) throw new ProviderError(0, 'claude_failed', status.problem, CLAUDE_AGENT.id);
  if (!status.signedIn) throw new ProviderError(401, 'claude_auth', 'Claude Code isn’t signed in. Run `claude auth login` in a terminal, then try again.', CLAUDE_AGENT.id);
  return (status.models ?? []).map(listedModel);
}

const EFFORTS: ClaudeEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const EFFORT_HINT: Record<ClaudeEffort, string> = {
  low: 'The fastest replies, and the least of your plan',
  medium: 'A balance of speed and depth',
  high: 'More thorough, for harder problems',
  xhigh: 'Very thorough: slower, and uses more of your plan',
  max: 'The most thinking: slow, and uses up a plan fast. For the hardest problems',
};

/**
 * What a Claude model offers for Thinking under Claude Code, as Claude Code names it: its own efforts (Low to Max, only
 * the ones this model takes), Off only where the model can stop thinking, and Auto only when Claude Code's default for
 * it isn't known. A chat starts on that default. The desktop app passes the choice to Claude Code as it is.
 */
export function claudeThinking(spec: ClaudeModel['thinking']): { levels: ThinkChoice[]; hints: Partial<Record<ThinkChoice, string>>; start: ThinkChoice | null } {
  const none = { levels: [], hints: {}, start: null };
  if (!spec) return none;
  const efforts = EFFORTS.filter(effort => spec.efforts.includes(effort));
  const fallback = spec.default && efforts.includes(spec.default as ClaudeEffort) ? (spec.default as ClaudeEffort) : null;
  const levels: ThinkChoice[] = [...(spec.off ? ['off' as const] : []), ...(fallback ? [] : ['auto' as const]), ...efforts];
  if (levels.length < 2) return none;
  const hints: Partial<Record<ThinkChoice, string>> = { off: 'No thinking: the fastest replies', auto: 'Claude Code’s default for this model' };
  for (const effort of efforts) hints[effort] = effort === fallback ? `${EFFORT_HINT[effort]}. Claude Code’s default for this model.` : EFFORT_HINT[effort];
  return { levels, hints, start: fallback ?? 'auto' };
}

/** The full model list, once the check Claude Code's status started is done; null when there was none to wait for. */
export async function claudeModels(bridge: DesktopClaude | null = claudeBridge()): Promise<ClaudeModel[] | null> {
  return bridge ? unwrap(await bridge.models()) : null;
}

/** A model Claude Code offers, as the model lists show it. */
export function listedModel(model: ClaudeModel): ListedModel {
  const { levels, hints, start } = claudeThinking(model.thinking);
  return {
    id: model.id,
    name: model.name,
    tools: true,
    group: model.pinned ? 'Specific versions' : 'Always the newest',
    ...(model.description ? { description: model.description } : {}),
    ...(model.contextTokens ? { contextTokens: model.contextTokens } : {}),
    thinking: levels,
    thinkingHints: hints,
    thinkingDefault: start,
  };
}

const told = new Set<string>();
/** A plan limit coming up, said once. */
function tell(notice: string | undefined) {
  if (!notice || told.has(notice)) return;
  told.add(notice);
  toast(notice);
}

/** The conversation with CLAUDE_AGENT_NOTE at the end of its system prompt (or as one, when it has none). */
function withNote(messages: WireMessage[]): WireMessage[] {
  const at = messages.findIndex(message => message.role === 'system');
  if (at === -1) return [{ role: 'system', content: CLAUDE_AGENT_NOTE }, ...messages];
  return messages.map((message, i) => (i === at ? { role: 'system', content: `${message.content}\n\n${CLAUDE_AGENT_NOTE}` } : message));
}

/** What the desktop app takes for Thinking. */
const CHOICES = new Set<ThinkChoice>(['off', 'auto', 'quick', 'deep', 'low', 'medium', 'high', 'xhigh', 'max']);

type Waiting = { update: (partial: Streamed) => void; done: (reply: ChatReply) => void; fail: (error: Error) => void };
const waiting = new Map<string, Waiting>();
let listening: DesktopClaude | null = null;

function listen(bridge: DesktopClaude) {
  if (listening === bridge) return;
  listening = bridge;
  bridge.onEvent((event: ClaudeEvent) => {
    const entry = waiting.get(event.id);
    if (!entry) return;
    if (event.type === 'update') entry.update({ content: event.content, reasoning: event.reasoning });
    else {
      waiting.delete(event.id);
      if (event.type === 'done') {
        tell(event.reply.notice);
        noteUsage(event.reply.plan);
        entry.done(event.reply);
      }
      else entry.fail(new ProviderError(event.code === 'claude_auth' ? 401 : event.code === 'claude_limit' ? 429 : 502, event.code, event.message, CLAUDE_AGENT.id));
    }
  });
}

/** One request through Claude Code: the same in and out as chatWithProvider. */
export function chatWithClaudeAgent(request: ChatRequest, onUpdate: (partial: Streamed) => void = () => {}, bridge: DesktopClaude | null = claudeBridge()): Promise<ChatReply> {
  if (!bridge) return Promise.reject(new ProviderError(0, 'claude_missing', 'Claude Agent works in the Quo desktop app.', CLAUDE_AGENT.id));
  listen(bridge);
  const id = crypto.randomUUID();
  const { signal } = request;
  return new Promise<ChatReply>((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const finish = () => signal?.removeEventListener('abort', onAbort);
    const onAbort = () => {
      waiting.delete(id);
      finish();
      void bridge.abort(id);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    waiting.set(id, {
      update: onUpdate,
      done: reply => {
        finish();
        resolve(reply);
      },
      fail: error => {
        finish();
        reject(error);
      },
    });
    const effort = request.effort && CHOICES.has(request.effort) ? request.effort : undefined;
    bridge.request({ id, model: request.model, messages: withNote(request.messages), tools: request.tools, ...(effort ? { effort } : {}), ...(request.oneOff ? { oneOff: true } : {}) }).then(
      result => {
        try {
          unwrap(result);
        } catch (error) {
          waiting.delete(id);
          finish();
          reject(new ProviderError(400, 'claude_failed', error instanceof Error ? error.message : 'Claude Code couldn’t answer.', CLAUDE_AGENT.id));
        }
      },
      error => {
        waiting.delete(id);
        finish();
        reject(error);
      },
    );
  });
}
