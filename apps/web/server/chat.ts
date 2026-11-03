import { randomUUID } from 'node:crypto';
import { costToMillicredits, CREDIT_USD, estimateCost, getCloudModel, isFreeModel, thinkingCap } from './cloudModels.js';
import { MILLI, getBalance, reserveCredits, settleCredits } from './credits.js';
import { getDb } from './db.js';
import { config, features, SETUP_MESSAGES } from './env.js';
import { noteCost } from './costs.js';
import { FREE_BUDGET_MESSAGE, freeBudgetReached, freeRemaining, refundFreeMessage, takeFree, takeFreeMessage } from './freeTier.js';
import { HttpError, readJson } from './http.js';
import { freeSubject, identify } from './identity.js';
import { defaultLevel, isLevel, levelFromLegacy, reasoningParam, type ThinkLevel } from '../shared/thinking.js';
import { FREE_CODE_CHARS, FREE_CODE_STEPS, WEB_TOOLS, isFolderless } from '../shared/agentTools.js';
import { validOffset, type Environment } from '../shared/environment.js';
import { agentSystemPrompt, AGENT_TOOL_NAMES, parseNotes, READ_ONLY_TOOLS, toolDefinitions, toolServerDefinitions, toolServerTools, type Platform } from '../shared/agentTools.js';
import { streamChat, UpstreamError, type ChatMessage, type ToolCall } from './openrouter.js';
import { IMAGE_DATA_URL, IMAGE_TOKENS, imagesOf, MAX_IMAGE_CHARS, MAX_REMOTE_IMAGES, textOfContent, type ContentPart } from '../shared/content.js';
import { FREE_SEARCHES_PER_REPLY, PAID_SEARCHES_PER_REPLY, SEARCH_FEE_USD, SEARCH_INPUT_TOKENS } from './webSearch.js';

/**
 * POST /api/chat — cloud chat, streamed as server-sent events:
 *   event: delta  data: {"c": "text", "r": "reasoning"}
 *   event: done   data: {"charged": credits, "balance": credits|null, "freeRemaining": n|null}
 *   event: search data: {"q": words}   (the model started a web search; see `web` below)
 *   event: error  data: {"error": code, "message": text}
 *
 * With `agent` set (Code mode, desktop app only) the request is one step of a coding
 * agent: the conversation so far, including the tools the model called and what they
 * returned. The server adds the system prompt and the tool list, the model replies
 * with text and/or tool calls, and the call arrives as one more event before `done`:
 *   event: tool_calls  data: {"calls": [{"id", "name", "arguments"}], "finish": "tool_calls"}
 * Only paid agent-capable models can be used, and each step is billed like a message.
 *
 * With `web` set (an ordinary chat, where the person lets models search) the model is offered web search and decides
 * itself whether the message needs it (webSearch.ts); `done` says what happened (`web: "searched"`, `"not_needed"`, or
 * `"limit"` when the free model's daily searches are used up and it could not search). On the free model a search draws
 * on a small daily allowance of its own (one is held for the reply and given back if the model doesn't search); on
 * credits, searches are paid for with them.
 *
 * The free default model uses the daily allowance first; everything else
 * (and the default model beyond the allowance) draws credits: reserved
 * before the call, settled at the real cost after — also when the user
 * stops the reply or disconnects. Chat content is never stored.
 */

const MAX_MESSAGES = 100;
const MAX_CHARS = 120_000;
const MIN_OUTPUT_TOKENS = 64;
const RESERVE_MARGIN = 1.2;

interface ChatRequest {
  model?: string;
  messages?: unknown;
  /** A level (off, quick, auto, deep), or, from an older app, true or false. */
  thinking?: unknown;
  web?: boolean;
  agent?: { tools?: unknown; project?: unknown; platform?: unknown; instructions?: unknown; role?: unknown; environment?: unknown; toolServers?: unknown };
}

const MAX_AGENT_MESSAGES = 600;
const MAX_AGENT_CHARS = 1_200_000;
const MAX_TOOL_RESULT_CHARS = 80_000;
const MAX_TOOL_ARGS_CHARS = 60_000;
// Room for the images a chat message can carry (shared/content.ts), under the host's 4.5 MB limit on a request.
const MAX_REQUEST_BYTES = 3_500_000;
const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,80}$/;
const NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
// A comment line while the model thinks without streaming: proxies (Cloudflare: 100 s) close a silent connection. Readers skip it.
const KEEP_ALIVE = ': keep-alive\n\n';
const KEEP_ALIVE_MS = 20_000;
const toCredits = (millicredits: number) => Math.round(millicredits / 100) / 10;
// What one reply cost gets two decimals: the cheapest models cost a few hundredths of a credit, and "0.0" would read as free.
const FREE_CODE_LIMIT_MESSAGE = 'You’ve used today’s free coding steps. They come back tomorrow; a stronger model with credits has no daily limit.';
const toCharge = (millicredits: number) => Math.round(millicredits / 10) / 100;

export async function handleChat(request: Request): Promise<Response> {
  if (!features.cloud) throw new HttpError(503, 'cloud_unavailable', 'Cloud models aren’t available right now.');
  const body = await readJson<ChatRequest>(request, MAX_REQUEST_BYTES);
  const model = getCloudModel(body.model ?? '');
  if (!model) throw new HttpError(400, 'unknown_model', 'That model isn’t available.');
  if (!isFreeModel(model) && !features.accounts) throw new HttpError(503, 'setup_required', SETUP_MESSAGES.paidModels);
  const agent = body.agent ? parseAgent(body.agent, model) : null;
  const history = agent ? validateAgentMessages(body.messages) : validateMessages(body.messages, model);
  // Code mode: the server's own instructions go first; the app can't supply or drop them.
  const messages: ChatMessage[] = agent ? [{ role: 'system', content: agent.prompt }, ...history] : history;
  // Thinking: the level asked for, as far as this model has it (the app only offers real ones, and the server checks). Code
  // mode leaves it to the model; the summariser asks for as little as it can.
  const level: ThinkLevel = agent ? (agent.role === 'summarize' ? 'quick' : 'auto') : isLevel(body.thinking) ? body.thinking : typeof body.thinking === 'boolean' ? levelFromLegacy(body.thinking) : defaultLevel(model.thinking);
  const reasoning = reasoningParam(model.thinking, level, thinkingCap(model));

  const db = await getDb();
  const identity = await identify(db, request);
  const freeKeys = { subject: freeSubject(identity), ip: identity.ip };
  const freeLimits = { perSubject: config.freeDailyMessages, perIp: config.freeDailyMessagesPerIp };
  const webKeys = { subject: `web:${freeKeys.subject}`, ip: `web:${freeKeys.ip}` };
  const webLimits = { perSubject: config.freeDailySearches, perIp: config.freeDailySearchesPerIp };
  const wantsWeb = !agent && body.web === true;
  // Free Code mode: a reply is a few steps, each with the conversation so far, so it has its own limits (steps in a
  // reply, the size of the conversation, and a daily allowance of steps) instead of one free message per request.
  // A chat with no folder yet is an ordinary message to the free model (one free message), not coding. The steps that
  // follow a tool (a search, say) are not free messages: they come from the small allowance of coding steps, with its caps.
  const continuing = history[history.length - 1]?.role === 'tool';
  const lightAgent = Boolean(agent?.light) && (!agent?.folderless || continuing);
  if (lightAgent) {
    const reply = history.slice(history.map(m => m.role).lastIndexOf('user') + 1);
    if (reply.filter(m => m.role === 'assistant').length >= FREE_CODE_STEPS) throw new HttpError(429, 'free_code_turn_limit', `The free model stops after ${FREE_CODE_STEPS} steps in a reply. Ask it to carry on, or choose a stronger model.`);
    if (history.reduce((sum, m) => sum + charsOf(m), 0) > FREE_CODE_CHARS) throw new HttpError(413, 'too_long', 'This conversation is too long for the free model’s Code mode. Start a new chat, or choose a stronger model.');
  }
  const codeKeys = { subject: `code:${freeKeys.subject}`, ip: `code:${freeKeys.ip}` };
  const codeLimits = { perSubject: config.freeDailyCodeSteps, perIp: config.freeDailyCodeStepsPerIp };
  const images = messages.reduce((sum, m) => sum + imagesOf(m.content).length, 0);
  let inputTokens = Math.ceil((messages.reduce((sum, m) => sum + charsOf(m), 0) + (agent?.toolChars ?? 0)) / 3.5) + 8 * messages.length + images * IMAGE_TOKENS;

  // Decide how this request is paid for.
  let mode: 'free' | 'credits';
  let maxTokens = lightAgent ? Math.min(model.maxOutput, 4096) : model.maxOutput;
  let holdId: string | null = null;
  let searchesAllowed = 0;
  let searchCost = 0;
  // Past the day's free budget the free model is paid with credits, like any other, by those who have them.
  const overBudget = isFreeModel(model) && (await freeBudgetReached(db));
  const freeTake = isFreeModel(model) && !overBudget ? await takeFree(db, lightAgent ? codeKeys : freeKeys, lightAgent ? codeLimits : freeLimits) : null;
  if (freeTake?.ok) {
    mode = 'free';
    if (freeTake.firstToday && !lightAgent) void noteCost(db, 'people:free');
    if (wantsWeb && (await takeFreeMessage(db, webKeys, webLimits))) searchesAllowed = FREE_SEARCHES_PER_REPLY;
  } else {
    if (!identity.userId) {
      throw isFreeModel(model)
        ? overBudget ? new HttpError(429, 'free_budget', FREE_BUDGET_MESSAGE) : lightAgent ? new HttpError(429, 'free_code_limit', FREE_CODE_LIMIT_MESSAGE) : new HttpError(429, 'free_limit', 'You’ve used today’s free cloud messages.')
        : new HttpError(401, 'sign_in_required', 'Sign in to use this model.');
    }
    if (wantsWeb) {
      // Held for every search the model may make; settled at what it really made.
      searchesAllowed = PAID_SEARCHES_PER_REPLY;
      searchCost = costToMillicredits(SEARCH_FEE_USD) * searchesAllowed;
      inputTokens += SEARCH_INPUT_TOKENS * searchesAllowed;
    }
    const want = Math.ceil((estimateCost(model, inputTokens, model.maxOutput) + searchCost) * RESERVE_MARGIN);
    const min = Math.ceil((estimateCost(model, inputTokens, MIN_OUTPUT_TOKENS) + searchCost) * RESERVE_MARGIN);
    const hold = await reserveCredits(db, identity.userId, want, min);
    if (!hold) {
      throw isFreeModel(model)
        ? overBudget ? new HttpError(429, 'free_budget', FREE_BUDGET_MESSAGE) : lightAgent ? new HttpError(429, 'free_code_limit', FREE_CODE_LIMIT_MESSAGE) : new HttpError(429, 'free_limit', 'You’ve used today’s free cloud messages.')
        : new HttpError(402, 'insufficient_credits', 'You don’t have enough credits for this model.');
    }
    holdId = hold.id;
    mode = 'credits';
    if (hold.amount < want) {
      // Not enough for a maximum-length reply: cap the reply to what's affordable.
      const affordable = hold.amount / RESERVE_MARGIN - estimateCost(model, inputTokens, 0) - searchCost;
      maxTokens = Math.max(MIN_OUTPUT_TOKENS, Math.floor(((affordable / MILLI) * CREDIT_USD * 1e6) / model.usdOut));
    }
  }

  const upstream = new AbortController();
  request.signal.addEventListener('abort', () => upstream.abort(), { once: true });
  const encoder = new TextEncoder();
  let outputChars = 0;
  let keepAlive: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          // Client went away; keep going so the request is settled.
        }
      };
      const send = (event: string, data: unknown) => write(sse(event, data));
      keepAlive = setInterval(() => write(KEEP_ALIVE), KEEP_ALIVE_MS);
      let usage = null as Awaited<ReturnType<typeof streamChat>> | null;
      let failure: { code: string; message: string } | null = null;
      try {
        const ask = (web: boolean) => streamChat(model, messages, {
          maxTokens,
          reasoning,
          tools: agent?.tools,
          ...(web ? { web: { maxUses: searchesAllowed } } : {}),
          signal: upstream.signal,
          onSearch: query => send('search', { q: query }),
          onDelta: delta => {
            outputChars += (delta.content?.length ?? 0) + (delta.reasoning?.length ?? 0);
            send('delta', { c: delta.content, r: delta.reasoning });
          },
        });
        try {
          usage = await ask(searchesAllowed > 0);
        } catch (error) {
          // A model or provider that won't take the search tool still answers, without it.
          if (!searchesAllowed || outputChars > 0 || upstream.signal.aborted || !(error instanceof UpstreamError) || error.status !== 400) throw error;
          console.error('[chat] search tool refused, answering without it', error.message);
          usage = await ask(false);
        }
        outputChars += usage.toolCalls.reduce((sum, call) => sum + call.function.arguments.length, 0);
      } catch (error) {
        if (!upstream.signal.aborted) {
          console.error('[chat] upstream', error instanceof UpstreamError ? `${error.status} ${error.message}` : error);
          failure = error instanceof UpstreamError && (error.status === 404 || error.status === 400)
            ? { code: 'model_unavailable', message: 'This model is unavailable right now. Try another.' }
            : { code: 'upstream_error', message: 'The model didn’t respond. Try again.' };
        }
      }

      // Settle: real cost when known, otherwise estimated from what was sent.
      let charged = 0;
      let balance: number | null = null;
      try {
        if (mode === 'credits' && holdId && identity.userId) {
          const actual = usage?.costUsd != null
            ? costToMillicredits(usage.costUsd)
            : estimateCost(model, usage?.promptTokens || inputTokens, usage?.completionTokens || Math.ceil(outputChars / 3.5)) + costToMillicredits(SEARCH_FEE_USD) * Math.min(usage?.searches ?? 0, searchesAllowed);
          const result = await settleCredits(db, identity.userId, holdId, outputChars === 0 && failure ? 0 : actual, `chat:${model.id}`, randomUUID());
          charged = result.charged;
          balance = result.balance;
        } else if (mode === 'free' && failure && outputChars === 0) {
          await refundFreeMessage(db, lightAgent ? codeKeys : freeKeys);
          if (searchesAllowed) await refundFreeMessage(db, webKeys);
        } else if (mode === 'free' && searchesAllowed && !usage?.searches) {
          await refundFreeMessage(db, webKeys); // offered a search, didn't need one: it stays in the allowance
        }
        if (mode === 'free' && identity.userId) balance = await getBalance(db, identity.userId);
      } catch (error) {
        console.error('[chat] settle', error);
      }
      // The day's totals: what this cost Quo (estimated when OpenRouter didn't say) and what it charged.
      if (usage || outputChars > 0) {
        const usd = usage?.costUsd ?? ((estimateCost(model, usage?.promptTokens || inputTokens, usage?.completionTokens || Math.ceil(outputChars / 3.5)) / MILLI) * CREDIT_USD + SEARCH_FEE_USD * (usage?.searches ?? 0));
        await noteCost(db, mode === 'credits' ? 'chat:paid' : lightAgent ? 'code:free' : 'chat:free', { usd, charged });
      }

      if (failure) send('error', { error: failure.code, message: failure.message });
      else {
        if (usage?.toolCalls.length) send('tool_calls', { calls: usage.toolCalls.map(call => ({ id: call.id, name: call.function.name, arguments: call.function.arguments })), finish: usage.finishReason });
        send('done', {
          finish: usage?.finishReason ?? null,
          charged: toCharge(charged),
          balance: balance === null ? null : toCredits(balance),
          freeRemaining: isFreeModel(model) && !lightAgent ? await freeRemaining(db, freeKeys, freeLimits).catch(() => null) : null,
          web: wantsWeb ? (!searchesAllowed ? 'limit' : usage?.searches ? 'searched' : 'not_needed') : null,
          webRemaining: mode === 'free' && wantsWeb ? await freeRemaining(db, webKeys, webLimits).catch(() => null) : null,
          ...(usage?.sources?.length ? { sources: usage.sources } : {}),
        });
      }
      clearInterval(keepAlive);
      try {
        controller.close();
      } catch {
        // Already closed.
      }
    },
    cancel() {
      clearInterval(keepAlive);
      upstream.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
      'x-quo-billing': mode,
    },
  });
}

const charsOf = (message: ChatMessage) =>
  textOfContent(message.content).length + (message.role === 'assistant' ? (message.tool_calls ?? []).reduce((sum, call) => sum + call.function.arguments.length + call.function.name.length, 0) : 0);

/**
 * A chat's messages, checked. A user message can carry images (shared/content.ts): data addresses of images only, a few
 * per request, to a model that reads them. Everything is copied field by field.
 */
function validateMessages(input: unknown, model: NonNullable<ReturnType<typeof getCloudModel>>): ChatMessage[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_MESSAGES) {
    throw new HttpError(400, 'bad_messages', 'Send between 1 and 100 messages.');
  }
  let chars = 0;
  let images = 0;
  const messages = input.map((raw): ChatMessage => {
    const message = raw as { role?: string; content?: unknown };
    if (message.role === 'user' && Array.isArray(message.content)) {
      if (message.content.length === 0 || message.content.length > 20) throw new HttpError(400, 'bad_messages', 'A message has too many parts.');
      const parts = message.content.map((part): ContentPart => {
        const value = part as { type?: unknown; text?: unknown; image_url?: { url?: unknown } };
        if (value?.type === 'text' && typeof value.text === 'string') {
          chars += value.text.length;
          return { type: 'text', text: value.text };
        }
        const url = value?.type === 'image_url' ? value.image_url?.url : undefined;
        if (typeof url !== 'string' || url.length > MAX_IMAGE_CHARS || !IMAGE_DATA_URL.test(url)) throw new HttpError(400, 'bad_messages', 'An attached image isn’t valid.');
        images++;
        return { type: 'image_url', image_url: { url } };
      });
      return { role: 'user', content: parts };
    }
    if (!['system', 'user', 'assistant'].includes(message.role ?? '') || typeof message.content !== 'string') {
      throw new HttpError(400, 'bad_messages', 'Each message needs a role and text.');
    }
    chars += message.content.length;
    return { role: message.role as 'system' | 'user' | 'assistant', content: message.content };
  });
  if (chars > MAX_CHARS) throw new HttpError(413, 'too_long', 'This conversation is too long. Start a new chat.');
  if (images > MAX_REMOTE_IMAGES) throw new HttpError(413, 'too_many_images', `Send up to ${MAX_REMOTE_IMAGES} images at a time.`);
  if (images && !model.vision) throw new HttpError(400, 'no_images', `${model.name} can’t read images. Choose a model that can, or send the text on its own.`);
  return messages;
}

/**
 * What the model is told about the moment: the date (from the server's own clock), which model it is and that it runs in
 * Quo's cloud. The app supplies only its clock's offset from UTC, checked here.
 */
function serverEnvironment(input: unknown, model: NonNullable<ReturnType<typeof getCloudModel>>): Environment {
  const given = (input && typeof input === 'object' ? input : {}) as { utcOffset?: unknown };
  return { now: new Date(), utcOffset: validOffset(given.utcOffset), model: { name: model.name, provider: model.provider }, route: 'quo-cloud' };
}

/** Code mode's setup, checked: an agent-capable paid model, and a known set of tools. */
function parseAgent(input: NonNullable<ChatRequest['agent']>, model: NonNullable<ReturnType<typeof getCloudModel>>) {
  // The free model gets a small, capped Code mode; every other model needs to be one that can really work with tools.
  const light = isFreeModel(model) && Boolean(model.agentLight);
  if (!light && (!model.agent || isFreeModel(model))) throw new HttpError(400, 'agent_unsupported', 'This model can’t be used for Code mode. Choose one of the frontier models.');
  if (light && (input.role === 'explore' || input.role === 'summarize')) throw new HttpError(400, 'agent_unsupported', 'Helpers and summaries come with the stronger models.');
  const requested = Array.isArray(input.tools) ? input.tools.filter((name): name is string => typeof name === 'string') : [];
  // A helper (role "explore") only ever gets the reading tools, whatever the app asks for: it cannot be handed more.
  // The summariser (role "summarize") gets no tools at all.
  const role = input.role === 'explore' ? 'explore' : input.role === 'summarize' ? 'summarize' : 'main';
  const wanted = role === 'summarize' ? [] : role === 'explore' ? [...READ_ONLY_TOOLS] : AGENT_TOOL_NAMES.filter(name => requested.includes(name) && !(light && name === 'task'));
  // A chat with no folder yet (the model can ask for one with open_project) has that tool and nothing else.
  const folderless = role === 'main' && isFolderless(wanted);
  const names = folderless ? ['open_project', ...WEB_TOOLS.filter(name => wanted.includes(name))] : wanted;
  if (role !== 'summarize' && !folderless && !READ_ONLY_TOOLS.every(name => names.includes(name))) throw new HttpError(400, 'bad_tools', 'Code mode needs at least the tools that read files.');
  const platform: Platform = input.platform === 'win32' || input.platform === 'darwin' ? input.platform : 'linux';
  const project = (typeof input.project === 'string' ? input.project : '').replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 60) || 'project';
  // Tools from tool servers the person added in the desktop app (checked, beside Quo's own): never for helpers or summaries.
  const servers = role === 'main' && !light ? toolServerTools(input.toolServers) : [];
  const tools = [...toolDefinitions(names), ...toolServerDefinitions(servers)];
  const env = role === 'summarize' ? null : serverEnvironment(input.environment, model);
  return { role, light, folderless, tools, toolChars: JSON.stringify(tools).length, prompt: agentSystemPrompt(project, platform, names, parseNotes(input.instructions), 'cloud', role, env) };
}

/**
 * The conversation of a Code-mode step: the user's messages, the model's (with the tools it
 * called), and the tools' results, each result answering a call the model made. Nothing else,
 * and the server's system prompt is never taken from the app.
 */
function validateAgentMessages(input: unknown): ChatMessage[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_AGENT_MESSAGES) throw new HttpError(400, 'bad_messages', 'Send a conversation of up to 600 messages.');
  let chars = 0;
  const called = new Set<string>();
  const messages = input.map((raw): ChatMessage => {
    const message = raw as { role?: string; content?: unknown; tool_calls?: unknown; tool_call_id?: unknown };
    if (typeof message.content !== 'string') throw new HttpError(400, 'bad_messages', 'Each message needs text.');
    if (message.role === 'user') {
      chars += message.content.length;
      return { role: 'user', content: message.content };
    }
    if (message.role === 'assistant') {
      const calls: ToolCall[] = [];
      if (message.tool_calls !== undefined) {
        if (!Array.isArray(message.tool_calls) || message.tool_calls.length > 20) throw new HttpError(400, 'bad_messages', 'Too many tool calls in one step.');
        for (const raw of message.tool_calls) {
          const call = raw as { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
          const { id, function: fn } = call;
          if (typeof id !== 'string' || !ID_PATTERN.test(id) || typeof fn?.name !== 'string' || !NAME_PATTERN.test(fn.name) || typeof fn.arguments !== 'string' || fn.arguments.length > MAX_TOOL_ARGS_CHARS) {
            throw new HttpError(400, 'bad_messages', 'A tool call isn’t valid.');
          }
          called.add(id);
          calls.push({ id, type: 'function', function: { name: fn.name, arguments: fn.arguments } });
        }
      }
      chars += message.content.length + calls.reduce((sum, call) => sum + call.function.arguments.length, 0);
      return calls.length ? { role: 'assistant', content: message.content, tool_calls: calls } : { role: 'assistant', content: message.content };
    }
    if (message.role === 'tool') {
      if (typeof message.tool_call_id !== 'string' || !called.has(message.tool_call_id)) throw new HttpError(400, 'bad_messages', 'A tool result doesn’t answer a tool call.');
      if (message.content.length > MAX_TOOL_RESULT_CHARS) throw new HttpError(413, 'too_long', 'A tool result is too long.');
      chars += message.content.length;
      return { role: 'tool', tool_call_id: message.tool_call_id, content: message.content };
    }
    throw new HttpError(400, 'bad_messages', 'Messages can come from the user, the model or a tool.');
  });
  if (messages[messages.length - 1].role === 'assistant') throw new HttpError(400, 'bad_messages', 'The conversation must end with the user or a tool result.');
  if (chars > MAX_AGENT_CHARS) throw new HttpError(413, 'too_long', 'This session has got too long. Start a new one.');
  return messages;
}
