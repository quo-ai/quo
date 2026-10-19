import { READ_ONLY_TOOLS, WEB_TOOLS, webSystemPrompt } from '../../shared/agentTools';
import { runAgent, countChanges, CONTEXT_CHARS } from '../agent/loop';
import { agentContextChars, askLocalAgentModel, prepareLocalAgent } from '../agent/local';
import { askOwnAgentModel } from '../agent/own';
import { codeSettings } from '../codeSettings';
import { askAgentModel } from '../agent/stream';
import { runSubagent, TASK_TOOL } from '../agent/subagent';
import type { CodeSession } from '../agent/session';
import type { AgentMessage, StepReply } from '../agent/types';
import { applyUsage } from '../cloud/account';
import { generateCloud, type CloudResult } from '../cloud/cloudEngine';
import { localEngine } from '../engine/localEngine';
import { listMemories, memoryPrompt } from '../memory/store';
import { generateOwn } from '../providers/generate';
import type { OwnModel } from '../providers/ownModels';
import { CLOUD_CONTEXT, type ModelChoice } from '../models';
import { allowUserUrls, runWebTool } from '../web/run';
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
  /** How full the model's memory is while it works (see agent/loop.ts). */
  onContext?: (tokens: number, exact: boolean) => void;
}

/** How much of a conversation to send a model whose window is `model.contextTokens`: about 70% of it, in characters. */
const contextChars = (model: OwnModel): number => Math.min(CONTEXT_CHARS, Math.round((model.contextTokens ?? 128_000) * 3 * 0.7));

/** Code mode: the model works on the project with the desktop app's tools until it has nothing left to do. Returns how many files it changed. */
export async function replyWithAgent(choice: CloudChoice | OwnChoice | LocalChoice, code: CodeSession, signal: AbortSignal, { prior, update, setStatus, onContext }: ReplyTarget): Promise<number> {
  await allowUserUrls(code.info.sessionId, [...prior].reverse().find(m => m.role === 'user')?.content ?? '');
  if (choice.kind === 'local') {
    // An offline model is loaded again with more room than a chat needs, which takes a moment.
    setStatus('loading');
    await prepareLocalAgent(choice.model);
  }
  setStatus('generating');
  const conversation: AgentMessage[] = prior.filter(m => m.content).map(m => ({ role: m.role, content: m.content }));
  const { useNotes, maxSteps } = codeSettings();
  // Helpers (the task tool) are for models with room to spare: not offline ones, whose window is small.
  const tools = choice.kind === 'local' ? code.tools : [...code.tools, TASK_TOOL];
  const options = (onText: (text: string) => void, extra: { tools?: string[]; role?: 'explore' } = {}) => ({ tools, project: code.project.name, platform: code.info.platform, instructions: useNotes ? code.info.instructions : null, signal, onText, ...extra });
  const ask = (extra: { tools?: string[]; role?: 'explore' } = {}): ((messages: AgentMessage[], onText: (text: string) => void) => Promise<StepReply>) =>
    choice.kind === 'own'
      ? (messages, onText) => askOwnAgentModel(choice.provider, choice.model, messages, options(onText, extra))
      : choice.kind === 'local'
        ? (messages, onText) => askLocalAgentModel(choice.model, messages, options(onText, extra))
        : (messages, onText) => askAgentModel(choice.model.id, messages, options(onText, extra));
  const windowChars = choice.kind === 'own' ? contextChars(choice.model) : choice.kind === 'local' ? agentContextChars() : undefined;
  let helperCost = 0;
  const outcome = await runAgent(conversation, {
    signal,
    maxSteps,
    askModel: ask(),
    ...(windowChars ? { contextChars: windowChars } : {}),
    runTool: (name, args) =>
      name === TASK_TOOL
        ? runSubagent(args, { askModel: ask({ tools: READ_ONLY_TOOLS, role: 'explore' }), runTool: (tool, toolArgs) => code.run(tool, toolArgs), signal, contextChars: windowChars, onCost: charged => (helperCost += charged) })
        : code.run(name, args),
    onUpdate: ({ steps, text }) => update({ content: text, steps }, false),
    onContext,
  });
  if (choice.kind === 'cloud') applyUsage({ balance: outcome.balance, freeRemaining: null });
  update({
    content: outcome.text,
    steps: outcome.steps,
    stopped: outcome.stopped || undefined,
    ...(choice.kind === 'cloud' ? { charged: Math.round((outcome.charged + helperCost) * 100) / 100 } : choice.kind === 'own' ? { usage: outcome.usage ?? undefined } : {}),
  }, true);
  return countChanges(outcome.steps);
}

/**
 * A chat that can search the web, without a project: the model is given search and page-reading tools that the desktop
 * app runs, for the user's own key or an offline model. It may open only addresses the user wrote, a search returned,
 * or a page it has read links to (web/sessions.js in the desktop app).
 */
export async function replyWithWeb(choice: OwnChoice | LocalChoice, sessionId: string, signal: AbortSignal, { prior, update, setStatus, onContext }: ReplyTarget): Promise<void> {
  const compact = choice.kind === 'local';
  await allowUserUrls(sessionId, [...prior].reverse().find(m => m.role === 'user')?.content ?? '');
  if (choice.kind === 'local') {
    setStatus('loading');
    await localEngine.load(choice.model);
  }
  setStatus('generating');
  let system = webSystemPrompt(compact ? 'local' : 'cloud', new Date().toISOString().slice(0, 10));
  // What the user asked Quo to remember goes to offline models only, as in a plain offline chat.
  if (choice.kind === 'local') system += memoryPrompt(await listMemories().catch(() => []), Math.min(1500, Math.floor(choice.model.contextSize * 0.35)));
  const options = (onText: (text: string) => void) => ({ tools: WEB_TOOLS, project: 'web', platform: 'linux', system, signal, onText });
  const outcome = await runAgent(prior.filter(m => m.content).map((m): AgentMessage => ({ role: m.role, content: m.content })), {
    signal,
    maxSteps: 8,
    askModel: choice.kind === 'own'
      ? (messages, onText) => askOwnAgentModel(choice.provider, choice.model, messages, options(onText))
      : (messages, onText) => askLocalAgentModel(choice.model, messages, options(onText)),
    contextChars: choice.kind === 'own' ? contextChars(choice.model) : agentContextChars(choice.model.contextSize),
    runTool: (name, args) => runWebTool(sessionId, name, args, compact),
    onUpdate: ({ steps, text }) => update({ content: text, steps }, false),
    onContext,
  });
  update({ content: outcome.text, steps: outcome.steps, stopped: outcome.stopped || undefined, ...(choice.kind === 'own' ? { usage: outcome.usage ?? undefined } : {}) }, true);
}

/** Whether the web search that was asked for ran (see CloudResult.web). */
export async function replyInCloud(choice: CloudChoice, thinking: boolean, { prior, update, setStatus }: ReplyTarget, options: { web?: boolean } = {}): Promise<CloudResult['web']> {
  setStatus('generating');
  const history = buildContext(CLOUD_PROMPT, prior, CLOUD_CONTEXT.contextSize, CLOUD_CONTEXT.maxTokens);
  const result = await generateCloud(choice.model.id, history, {
    thinking,
    web: options.web,
    onUpdate: ({ content, reasoning }) => update({ content, reasoning }, false),
  });
  applyUsage(result);
  update({ content: result.content, reasoning: result.reasoning || undefined, stopped: result.stopped || undefined, charged: result.charged }, true);
  return result.web;
}

/** A model at a provider the user reached with their own key: straight from this computer to the provider, nothing through Quo. */
export async function replyOwn(choice: OwnChoice, { prior, update, setStatus }: ReplyTarget, options: { web?: boolean } = {}): Promise<void> {
  setStatus('generating');
  const history = buildContext(CLOUD_PROMPT, prior, Math.min(choice.model.contextTokens ?? CLOUD_CONTEXT.contextSize, 64_000), CLOUD_CONTEXT.maxTokens);
  const result = await generateOwn(choice.provider, choice.model, history, ({ content, reasoning }) => update({ content, reasoning }, false), options);
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
