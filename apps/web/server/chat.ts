import { randomUUID } from 'node:crypto';
import { costToMillicredits, CREDIT_USD, estimateCost, getCloudModel, isFreeModel } from './cloudModels.js';
import { MILLI, getBalance, reserveCredits, settleCredits } from './credits.js';
import { getDb } from './db.js';
import { config, features, SETUP_MESSAGES } from './env.js';
import { freeRemaining, refundFreeMessage, takeFreeMessage } from './freeTier.js';
import { HttpError, readJson } from './http.js';
import { freeSubject, identify } from './identity.js';
import { agentSystemPrompt, AGENT_TOOL_NAMES, parseNotes, READ_ONLY_TOOLS, toolDefinitions, type Platform } from '../shared/agentTools.js';
import { streamChat, UpstreamError, type ChatMessage, type ToolCall } from './openrouter.js';
import { SEARCH_FEE_USD, SEARCH_INPUT_TOKENS } from './webSearch.js';

/**
 * POST /api/chat — cloud chat, streamed as server-sent events:
 *   event: delta  data: {"c": "text", "r": "reasoning"}
 *   event: done   data: {"charged": credits, "balance": credits|null, "freeRemaining": n|null}
 *   event: error  data: {"error": code, "message": text}
 *
 * With `agent` set (Code mode, desktop app only) the request is one step of a coding
 * agent: the conversation so far, including the tools the model called and what they
 * returned. The server adds the system prompt and the tool list, the model replies
 * with text and/or tool calls, and the call arrives as one more event before `done`:
 *   event: tool_calls  data: {"calls": [{"id", "name", "arguments"}], "finish": "tool_calls"}
 * Only paid agent-capable models can be used, and each step is billed like a message.
 *
 * With `web` set (an ordinary chat) the model's reply is grounded by one web search (webSearch.ts). On the free
 * model that draws on a small daily search allowance of its own; once it is used the message is answered without
 * a search and `done` says so (`web: "limit"`). On credits, the search is paid for with them.
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
  thinking?: boolean;
  web?: boolean;
  agent?: { tools?: unknown; project?: unknown; platform?: unknown; instructions?: unknown; role?: unknown };
}

const MAX_AGENT_MESSAGES = 600;
const MAX_AGENT_CHARS = 1_200_000;
const MAX_TOOL_RESULT_CHARS = 80_000;
const MAX_TOOL_ARGS_CHARS = 60_000;
const MAX_REQUEST_BYTES = 2_000_000;
const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,80}$/;
const NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const toCredits = (millicredits: number) => Math.round(millicredits / 100) / 10;
// What one reply cost gets two decimals: the cheapest models cost a few hundredths of a credit, and "0.0" would read as free.
const toCharge = (millicredits: number) => Math.round(millicredits / 10) / 100;

export async function handleChat(request: Request): Promise<Response> {
  if (!features.cloud) throw new HttpError(503, 'cloud_unavailable', 'Cloud models aren’t available right now.');
  const body = await readJson<ChatRequest>(request, MAX_REQUEST_BYTES);
  const model = getCloudModel(body.model ?? '');
  if (!model) throw new HttpError(400, 'unknown_model', 'That model isn’t available.');
  if (!isFreeModel(model) && !features.accounts) throw new HttpError(503, 'setup_required', SETUP_MESSAGES.paidModels);
  const agent = body.agent ? parseAgent(body.agent, model) : null;
  const history = agent ? validateAgentMessages(body.messages) : validateMessages(body.messages);
  // Code mode: the server's own instructions go first; the app can't supply or drop them.
  const messages: ChatMessage[] = agent ? [{ role: 'system', content: agent.prompt }, ...history] : history;
  const thinking = !agent && Boolean(body.thinking) && model.supportsThinking;

  const db = await getDb();
  const identity = await identify(db, request);
  const freeKeys = { subject: freeSubject(identity), ip: identity.ip };
  const freeLimits = { perSubject: config.freeDailyMessages, perIp: config.freeDailyMessagesPerIp };
  const webKeys = { subject: `web:${freeKeys.subject}`, ip: `web:${freeKeys.ip}` };
  const webLimits = { perSubject: config.freeDailySearches, perIp: config.freeDailySearchesPerIp };
  const wantsWeb = !agent && body.web === true;
  let inputTokens = Math.ceil((messages.reduce((sum, m) => sum + charsOf(m), 0) + (agent?.toolChars ?? 0)) / 3.5) + 8 * messages.length;

  // Decide how this request is paid for.
  let mode: 'free' | 'credits';
  let maxTokens = model.maxOutput;
  let holdId: string | null = null;
  let searching = false;
  let searchCost = 0;
  if (isFreeModel(model) && (await takeFreeMessage(db, freeKeys, freeLimits))) {
    mode = 'free';
    searching = wantsWeb && (await takeFreeMessage(db, webKeys, webLimits));
  } else {
    if (!identity.userId) {
      throw isFreeModel(model)
        ? new HttpError(429, 'free_limit', 'You’ve used today’s free cloud messages.')
        : new HttpError(401, 'sign_in_required', 'Sign in to use this model.');
    }
    if (wantsWeb) {
      searching = true;
      searchCost = costToMillicredits(SEARCH_FEE_USD);
      inputTokens += SEARCH_INPUT_TOKENS;
    }
    const want = Math.ceil((estimateCost(model, inputTokens, model.maxOutput) + searchCost) * RESERVE_MARGIN);
    const min = Math.ceil((estimateCost(model, inputTokens, MIN_OUTPUT_TOKENS) + searchCost) * RESERVE_MARGIN);
    const hold = await reserveCredits(db, identity.userId, want, min);
    if (!hold) {
      throw isFreeModel(model)
        ? new HttpError(429, 'free_limit', 'You’ve used today’s free cloud messages.')
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

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(sse(event, data)));
        } catch {
          // Client went away; keep going so the request is settled.
        }
      };
      let usage = null as Awaited<ReturnType<typeof streamChat>> | null;
      let failure: { code: string; message: string } | null = null;
      try {
        usage = await streamChat(model, messages, {
          maxTokens,
          thinking,
          tools: agent?.tools,
          web: searching,
          signal: upstream.signal,
          onDelta: delta => {
            outputChars += (delta.content?.length ?? 0) + (delta.reasoning?.length ?? 0);
            send('delta', { c: delta.content, r: delta.reasoning });
          },
        });
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
            : estimateCost(model, usage?.promptTokens || inputTokens, usage?.completionTokens || Math.ceil(outputChars / 3.5)) + searchCost;
          const result = await settleCredits(db, identity.userId, holdId, outputChars === 0 && failure ? 0 : actual, `chat:${model.id}`, randomUUID());
          charged = result.charged;
          balance = result.balance;
        } else if (mode === 'free' && failure && outputChars === 0) {
          await refundFreeMessage(db, freeKeys);
          if (searching) await refundFreeMessage(db, webKeys);
        }
        if (mode === 'free' && identity.userId) balance = await getBalance(db, identity.userId);
      } catch (error) {
        console.error('[chat] settle', error);
      }

      if (failure) send('error', { error: failure.code, message: failure.message });
      else {
        if (usage?.toolCalls.length) send('tool_calls', { calls: usage.toolCalls.map(call => ({ id: call.id, name: call.function.name, arguments: call.function.arguments })), finish: usage.finishReason });
        send('done', {
          finish: usage?.finishReason ?? null,
          charged: toCharge(charged),
          balance: balance === null ? null : toCredits(balance),
          freeRemaining: isFreeModel(model) ? await freeRemaining(db, freeKeys, freeLimits).catch(() => null) : null,
          web: wantsWeb ? (searching ? 'searched' : 'limit') : null,
          webRemaining: mode === 'free' && wantsWeb ? await freeRemaining(db, webKeys, webLimits).catch(() => null) : null,
        });
      }
      try {
        controller.close();
      } catch {
        // Already closed.
      }
    },
    cancel() {
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
  message.content.length + (message.role === 'assistant' ? (message.tool_calls ?? []).reduce((sum, call) => sum + call.function.arguments.length + call.function.name.length, 0) : 0);

function validateMessages(input: unknown): ChatMessage[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_MESSAGES) {
    throw new HttpError(400, 'bad_messages', 'Send between 1 and 100 messages.');
  }
  let chars = 0;
  const messages = input.map((raw): ChatMessage => {
    const message = raw as { role?: string; content?: unknown };
    if (!['system', 'user', 'assistant'].includes(message.role ?? '') || typeof message.content !== 'string') {
      throw new HttpError(400, 'bad_messages', 'Each message needs a role and text.');
    }
    chars += message.content.length;
    return { role: message.role as 'system' | 'user' | 'assistant', content: message.content };
  });
  if (chars > MAX_CHARS) throw new HttpError(413, 'too_long', 'This conversation is too long. Start a new chat.');
  return messages;
}

/** Code mode's setup, checked: an agent-capable paid model, and a known set of tools. */
function parseAgent(input: NonNullable<ChatRequest['agent']>, model: NonNullable<ReturnType<typeof getCloudModel>>) {
  if (!model.agent || isFreeModel(model)) throw new HttpError(400, 'agent_unsupported', 'This model can’t be used for Code mode. Choose one of the frontier models.');
  const requested = Array.isArray(input.tools) ? input.tools.filter((name): name is string => typeof name === 'string') : [];
  // A helper (role "explore") only ever gets the reading tools, whatever the app asks for: it cannot be handed more.
  const role = input.role === 'explore' ? 'explore' : 'main';
  const names = role === 'explore' ? [...READ_ONLY_TOOLS] : AGENT_TOOL_NAMES.filter(name => requested.includes(name));
  if (!READ_ONLY_TOOLS.every(name => names.includes(name))) throw new HttpError(400, 'bad_tools', 'Code mode needs at least the tools that read files.');
  const platform: Platform = input.platform === 'win32' || input.platform === 'darwin' ? input.platform : 'linux';
  const project = (typeof input.project === 'string' ? input.project : '').replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 60) || 'project';
  const tools = toolDefinitions(names);
  return { tools, toolChars: JSON.stringify(tools).length, prompt: agentSystemPrompt(project, platform, names, parseNotes(input.instructions), 'cloud', role) };
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
