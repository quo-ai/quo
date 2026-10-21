import { FREE_CODE_CHARS, FREE_CODE_STEPS, READ_ONLY_TOOLS, WEB_TOOLS, chatPrompt, webSystemPrompt } from '../../shared/agentTools';
import { runAgent, countChanges, CONTEXT_CHARS } from '../agent/loop';
import { agentContextChars, askLocalAgentModel, prepareLocalAgent } from '../agent/local';
import { askOwnAgentModel } from '../agent/own';
import { codeSettings } from '../codeSettings';
import { askAgentModel } from '../agent/stream';
import type { ThinkLevel } from '../../shared/thinking';
import { wireThinking } from './thinking';
import { openProjectTool, type FolderOpener } from '../agent/folder';
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
import { noteWebChange } from './webChange';
import { environmentFor, noteFor } from './environment';
import type { Message } from './types';
import { SearchSteps } from './searchSteps';

/**
 * The three ways Quo answers: a cloud model working in a project (Code mode), a cloud
 * model chatting, and an offline model on this device. Each takes the conversation so
 * far and reports the reply through `update` as it grows (`persist` false) and once
 * more when it's final (`persist` true).
 */

const LOCAL_PROMPT = chatPrompt('local');
const CLOUD_PROMPT = chatPrompt('cloud');

const FOLDER_TOOL = 'open_project';

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
  /** The chat this reply belongs to (Code mode says when web search changed between its messages: webChange.ts). */
  chatId?: string;
}

/** How much of a conversation to send a model whose window is `model.contextTokens`: about 70% of it, in characters. */
const contextChars = (model: OwnModel): number => Math.min(CONTEXT_CHARS, Math.round((model.contextTokens ?? 128_000) * 3 * 0.7));

/** Code mode: the model works on the project with the desktop app's tools until it has nothing left to do. Returns how many files it changed. */
export async function replyWithAgent(choice: CloudChoice | OwnChoice | LocalChoice, code: CodeSession | null, signal: AbortSignal, { prior, update, setStatus, onContext, chatId }: ReplyTarget, folder?: (FolderOpener & { web?: boolean; webSessionId?: string })): Promise<number> {
  // Without a folder yet the model has one tool, open_project, and decides from the message whether it needs it; once a
  // folder is open (now or mid-reply) everything below follows the session.
  let session = code;
  const lastUser = [...prior].reverse().find(m => m.role === 'user')?.content ?? '';
  if (session) await allowUserUrls(session.info.sessionId, lastUser);
  // Without a folder, search and page reading go straight to the desktop's web service under the chat's own web session.
  const webBefore = Boolean(folder?.web && folder.webSessionId);
  if (webBefore) await allowUserUrls(folder!.webSessionId!, lastUser);
  if (choice.kind === 'local') {
    // An offline model is loaded again with more room than a chat needs, which takes a moment.
    setStatus('loading');
    await prepareLocalAgent(choice.model);
  }
  setStatus('generating');
  const { useNotes, maxSteps } = codeSettings();
  // The free model's Code mode is small on purpose (few steps, a short conversation, no helpers or summaries).
  const light = choice.kind === 'cloud' && choice.model.free && !choice.model.agent;
  // Helpers (the task tool) are for models with room to spare: not offline ones, whose window is small, nor the free one.
  const toolsNow = () => (!session ? [FOLDER_TOOL, ...(webBefore ? WEB_TOOLS : [])] : choice.kind === 'local' || light ? session.tools : [...session.tools, TASK_TOOL]);
  // Web search turned on or off since this chat's last message: say so, or the model may repeat what it said before.
  const conversation: AgentMessage[] = noteWebChange(prior.filter(m => m.content).map(m => ({ role: m.role, content: m.content })), chatId, toolsNow().includes('web_search'));
  const platform = session?.info.platform ?? (typeof window !== 'undefined' ? window.quoDesktop?.platform : undefined) ?? 'linux';
  // Each request carries a fresh environment note (the clock moves, plan mode can be switched) for the models the app prompts;
  // Quo's own cloud models get the same from the server.
  const options = (onText: (text: string) => void, extra: { tools?: string[]; role?: 'explore' | 'summarize' } = {}) => {
    const tools = toolsNow();
    return {
      tools,
      project: session?.project.name ?? '',
      platform,
      instructions: session && useNotes ? session.info.instructions : null,
      signal,
      onText,
      ...(extra.role === 'summarize' ? {} : { environment: environmentFor(choice) }),
      ...extra,
    };
  };
  const ask = (extra: { tools?: string[]; role?: 'explore' | 'summarize' } = {}): ((messages: AgentMessage[], onText: (text: string) => void) => Promise<StepReply>) =>
    choice.kind === 'own'
      ? (messages, onText) => askOwnAgentModel(choice.provider, choice.model, messages, options(onText, extra))
      : choice.kind === 'local'
        ? (messages, onText) => askLocalAgentModel(choice.model, messages, options(onText, extra))
        : (messages, onText) => askAgentModel(choice.model.id, messages, options(onText, extra));
  const windowChars = light ? FREE_CODE_CHARS * 0.85 : choice.kind === 'own' ? contextChars(choice.model) : choice.kind === 'local' ? agentContextChars((localEngine as { contextSize?: number | null }).contextSize ?? undefined) : undefined;
  let helperCost = 0;
  const outcome = await runAgent(conversation, {
    signal,
    maxSteps: light ? Math.min(maxSteps, FREE_CODE_STEPS) : maxSteps,
    askModel: ask(),
    // A long session is written up by the model rather than forgotten. Not for offline models: a small one writes a poor report.
    ...(choice.kind === 'local' || light
      ? {}
      : {
          summarize: async (transcript: string) => {
            const reply = await ask({ tools: [], role: 'summarize' })([{ role: 'user', content: transcript }], () => {});
            helperCost += reply.charged;
            return reply.content;
          },
        }),
    ...(windowChars ? { contextChars: windowChars } : {}),
    runTool: async (name, args) => {
      if (name === FOLDER_TOOL) {
        if (!folder) return { ok: false, text: 'A folder can’t be opened here.', display: { kind: 'error' } };
        const opened = await openProjectTool(args, session, folder);
        if (opened.session && !session) await allowUserUrls(opened.session.info.sessionId, lastUser);
        session = opened.session;
        return opened.result;
      }
      if (!session && webBefore && WEB_TOOLS.includes(name)) return runWebTool(folder!.webSessionId!, name, args, choice.kind === 'local');
      if (!session) return { ok: false, text: 'No folder is open yet. Call open_project first if the request needs the person’s files.', display: { kind: 'error' } };
      const active = session;
      return name === TASK_TOOL
        ? runSubagent(args, { askModel: ask({ tools: READ_ONLY_TOOLS, role: 'explore' }), runTool: (tool, toolArgs) => active.run(tool, toolArgs), signal, contextChars: windowChars, onCost: charged => (helperCost += charged) })
        : active.run(name, args);
    },
    onUpdate: ({ steps, text }) => update({ content: text, steps }, false),
    onContext,
  });
  if (choice.kind === 'cloud') applyUsage({ balance: outcome.balance, freeRemaining: null });
  update({
    content: outcome.text,
    steps: outcome.steps,
    sources: outcome.sources.length ? outcome.sources : undefined,
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
  let system = webSystemPrompt(compact ? 'local' : 'cloud', new Date().toLocaleDateString('en-CA')); // today on the person's clock, as 2026-10-19
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
  update({ content: outcome.text, steps: outcome.steps, sources: outcome.sources.length ? outcome.sources : undefined, stopped: outcome.stopped || undefined, ...(choice.kind === 'own' ? { usage: outcome.usage ?? undefined } : {}) }, true);
}

/** Whether the web search that was asked for ran (see CloudResult.web). */
export async function replyInCloud(choice: CloudChoice, thinking: ThinkLevel, { prior, update, setStatus }: ReplyTarget, options: { web?: boolean } = {}): Promise<CloudResult['web']> {
  setStatus('generating');
  const history = buildContext(CLOUD_PROMPT + noteFor(choice), prior, CLOUD_CONTEXT.contextSize, CLOUD_CONTEXT.maxTokens);
  const searches = new SearchSteps();
  let text = 0;
  const result = await generateCloud(choice.model.id, history, {
    thinking: wireThinking(choice, thinking),
    web: options.web,
    onUpdate: ({ content, reasoning }) => {
      text = content.length;
      const settled = searches.answering(text);
      update({ content, reasoning, ...(settled ? { steps: settled } : {}) }, false);
    },
    onSearch: query => update({ steps: searches.start(query, text) }, false),
  });
  applyUsage(result);
  const steps = searches.finish(result.web === 'searched', result.stopped);
  update({ content: result.content, reasoning: result.reasoning || undefined, stopped: result.stopped || undefined, charged: result.charged, steps, sources: result.sources.length ? result.sources : undefined }, true);
  return result.web;
}

/** A model at a provider the user reached with their own key: straight from this computer to the provider, nothing through Quo. */
export async function replyOwn(choice: OwnChoice, { prior, update, setStatus }: ReplyTarget, options: { web?: boolean } = {}): Promise<void> {
  setStatus('generating');
  const history = buildContext(CLOUD_PROMPT + noteFor(choice), prior, Math.min(choice.model.contextTokens ?? CLOUD_CONTEXT.contextSize, 64_000), CLOUD_CONTEXT.maxTokens);
  const searches = new SearchSteps();
  let started = 0;
  const result = await generateOwn(choice.provider, choice.model, history, ({ content, reasoning, searches: words = [] }) => {
    // A new search shows as it starts; its words fill in when the provider has sent them.
    while (started < words.length) searches.start(words[started++], content.length);
    const named = words.length ? searches.name(words.at(-1) ?? '') : null;
    const settled = searches.answering(content.length);
    update({ content, reasoning, ...(settled ?? named ? { steps: settled ?? named! } : {}) }, false);
  }, options);
  const steps = searches.finish(false, result.stopped);
  update({ content: result.content, reasoning: result.reasoning || undefined, stopped: result.stopped || undefined, usage: result.usage ?? undefined, steps, sources: result.sources.length ? result.sources : undefined }, true);
}

export async function replyOffline(choice: LocalChoice, thinking: boolean, { prior, update, setStatus }: ReplyTarget): Promise<void> {
  const model = choice.model;
  // What the user asked Quo to remember goes to offline models only (never a cloud model), using up to ~10% of the context.
  const memories = await listMemories().catch(() => []);
  const instructions = LOCAL_PROMPT + memoryPrompt(memories, Math.min(1500, Math.floor(model.contextSize * 0.35))) + noteFor(choice);
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
