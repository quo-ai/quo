import { runAgent, countChanges, CONTEXT_CHARS } from '../agent/loop';
import { agentContextChars, askLocalAgentModel, prepareLocalAgent } from '../agent/local';
import { askOwnAgentModel } from '../agent/own';
import { codeSettings } from '../codeSettings';
import { askAgentModel } from '../agent/stream';
import type { CodeSession } from '../agent/session';
import type { AgentMessage } from '../agent/types';
import { applyUsage } from '../cloud/account';
import { generateCloud } from '../cloud/cloudEngine';
import { localEngine } from '../engine/localEngine';
import { listMemories, memoryPrompt } from '../memory/store';
import { generateOwn } from '../providers/generate';
import type { OwnModel } from '../providers/ownModels';
import { CLOUD_CONTEXT, type ModelChoice } from '../models';
import { buildContext } from './context';
import type { Message } from './types';

/**
 * The three ways Quo answers: a cloud model working in a project (Code mode), a cloud
 * model chatting, and an offline model on this device. Each takes the conversation so
 * far and reports the reply through `update` as it grows (`persist` false) and once
 * more when it's final (`persist` true).
 */

const LOCAL_PROMPT = 'You are Quo, a helpful private AI assistant running entirely on the user’s device. Be clear and concise. Use markdown when it helps readability.';
const CLOUD_PROMPT = 'You are Quo, a helpful AI assistant. Be clear and concise. Use markdown when it helps readability.';

export type CloudChoice = Extract<ModelChoice, { kind: 'cloud' }>;
export type LocalChoice = Extract<ModelChoice, { kind: 'local' }>;
export type OwnChoice = Extract<ModelChoice, { kind: 'own' }>;
export type ReplyStatus = 'loading' | 'generating';

export interface ReplyTarget {
  /** The conversation before this reply. */
  prior: Message[];
  update: (patch: Partial<Message>, persist: boolean) => void;
  setStatus: (status: ReplyStatus) => void;
}

/** How much of a conversation to send a model whose window is `model.contextTokens`: about 70% of it, in characters. */
const contextChars = (model: OwnModel): number => Math.min(CONTEXT_CHARS, Math.round((model.contextTokens ?? 128_000) * 3 * 0.7));

/** Code mode: the model works on the project with the desktop app's tools until it has nothing left to do. Returns how many files it changed. */
export async function replyWithAgent(choice: CloudChoice | OwnChoice | LocalChoice, code: CodeSession, signal: AbortSignal, { prior, update, setStatus }: ReplyTarget): Promise<number> {
  if (choice.kind === 'local') {
    // An offline model is loaded again with more room than a chat needs, which takes a moment.
    setStatus('loading');
    await prepareLocalAgent(choice.model);
  }
  setStatus('generating');
  const conversation: AgentMessage[] = prior.filter(m => m.content).map(m => ({ role: m.role, content: m.content }));
  const { useNotes, maxSteps } = codeSettings();
  const options = (onText: (text: string) => void) => ({ tools: code.tools, project: code.project.name, platform: code.info.platform, instructions: useNotes ? code.info.instructions : null, signal, onText });
  const outcome = await runAgent(conversation, {
    signal,
    maxSteps,
    askModel: choice.kind === 'own'
      ? (messages, onText) => askOwnAgentModel(choice.provider, choice.model, messages, options(onText))
      : choice.kind === 'local'
        ? (messages, onText) => askLocalAgentModel(choice.model, messages, options(onText))
        : (messages, onText) => askAgentModel(choice.model.id, messages, options(onText)),
    ...(choice.kind === 'own' ? { contextChars: contextChars(choice.model) } : choice.kind === 'local' ? { contextChars: agentContextChars() } : {}),
    runTool: (name, args) => code.run(name, args),
    onUpdate: ({ steps, text }) => update({ content: text, steps }, false),
  });
  if (choice.kind === 'cloud') applyUsage({ balance: outcome.balance, freeRemaining: null });
  update({
    content: outcome.text,
    steps: outcome.steps,
    stopped: outcome.stopped || undefined,
    ...(choice.kind === 'cloud' ? { charged: outcome.charged } : choice.kind === 'own' ? { usage: outcome.usage ?? undefined } : {}),
  }, true);
  return countChanges(outcome.steps);
}

export async function replyInCloud(choice: CloudChoice, thinking: boolean, { prior, update, setStatus }: ReplyTarget): Promise<void> {
  setStatus('generating');
  const history = buildContext(CLOUD_PROMPT, prior, CLOUD_CONTEXT.contextSize, CLOUD_CONTEXT.maxTokens);
  const result = await generateCloud(choice.model.id, history, {
    thinking,
    onUpdate: ({ content, reasoning }) => update({ content, reasoning }, false),
  });
  applyUsage(result);
  update({ content: result.content, reasoning: result.reasoning || undefined, stopped: result.stopped || undefined, charged: result.charged }, true);
}

/** A model at a provider the user reached with their own key: straight from this computer to the provider, nothing through Quo. */
export async function replyOwn(choice: OwnChoice, { prior, update, setStatus }: ReplyTarget): Promise<void> {
  setStatus('generating');
  const history = buildContext(CLOUD_PROMPT, prior, Math.min(choice.model.contextTokens ?? CLOUD_CONTEXT.contextSize, 64_000), CLOUD_CONTEXT.maxTokens);
  const result = await generateOwn(choice.provider, choice.model, history, ({ content, reasoning }) => update({ content, reasoning }, false));
  update({ content: result.content, reasoning: result.reasoning || undefined, stopped: result.stopped || undefined, usage: result.usage ?? undefined }, true);
}

export async function replyOffline(choice: LocalChoice, thinking: boolean, { prior, update, setStatus }: ReplyTarget): Promise<void> {
  const model = choice.model;
  // What the user asked Quo to remember goes to offline models only (never a cloud model), using up to ~10% of the context.
  const memories = await listMemories().catch(() => []);
  const instructions = LOCAL_PROMPT + memoryPrompt(memories, Math.min(1500, Math.floor(model.contextSize * 0.35)));
  const history = buildContext(instructions, prior, model.contextSize, model.maxTokens);
  if (localEngine.modelId !== model.id) setStatus('loading');
  await localEngine.load(model);
  setStatus('generating');
  const result = await localEngine.generate(model, history, {
    thinking,
    onUpdate: ({ content, reasoning }) => update({ content, reasoning }, false),
  });
  update({
    content: result.content,
    reasoning: result.reasoning || undefined,
    stopped: result.stopped || undefined,
    stats: { tokens: result.tokens, tokensPerSecond: result.tokensPerSecond, timeToFirstTokenMs: result.timeToFirstTokenMs },
  }, true);
}
