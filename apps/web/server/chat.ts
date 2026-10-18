import { randomUUID } from 'node:crypto';
import { costToMillicredits, CREDIT_USD, estimateCost, getCloudModel, isFreeModel } from './cloudModels.js';
import { MILLI, getBalance, reserveCredits, settleCredits } from './credits.js';
import { getDb } from './db.js';
import { config, features, SETUP_MESSAGES } from './env.js';
import { freeRemaining, refundFreeMessage, takeFreeMessage } from './freeTier.js';
import { HttpError, readJson } from './http.js';
import { freeSubject, identify } from './identity.js';
import { streamChat, UpstreamError, type ChatMessage } from './openrouter.js';

/**
 * POST /api/chat — cloud chat, streamed as server-sent events:
 *   event: delta  data: {"c": "text", "r": "reasoning"}
 *   event: done   data: {"charged": credits, "balance": credits|null, "freeRemaining": n|null}
 *   event: error  data: {"error": code, "message": text}
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
  messages?: ChatMessage[];
  thinking?: boolean;
}

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const toCredits = (millicredits: number) => Math.round(millicredits / 100) / 10;

export async function handleChat(request: Request): Promise<Response> {
  if (!features.cloud) throw new HttpError(503, 'cloud_unavailable', 'Cloud models aren’t available right now.');
  const body = await readJson<ChatRequest>(request);
  const model = getCloudModel(body.model ?? '');
  if (!model) throw new HttpError(400, 'unknown_model', 'That model isn’t available.');
  if (!isFreeModel(model) && !features.accounts) throw new HttpError(503, 'setup_required', SETUP_MESSAGES.paidModels);
  const messages = validateMessages(body.messages);
  const thinking = Boolean(body.thinking) && model.supportsThinking;

  const db = await getDb();
  const identity = await identify(db, request);
  const freeKeys = { subject: freeSubject(identity), ip: identity.ip };
  const freeLimits = { perSubject: config.freeDailyMessages, perIp: config.freeDailyMessagesPerIp };
  const inputTokens = Math.ceil(messages.reduce((sum, m) => sum + m.content.length, 0) / 3.5) + 8 * messages.length;

  // Decide how this request is paid for.
  let mode: 'free' | 'credits';
  let maxTokens = model.maxOutput;
  let holdId: string | null = null;
  if (isFreeModel(model) && (await takeFreeMessage(db, freeKeys, freeLimits))) {
    mode = 'free';
  } else {
    if (!identity.userId) {
      throw isFreeModel(model)
        ? new HttpError(429, 'free_limit', 'You’ve used today’s free cloud messages.')
        : new HttpError(401, 'sign_in_required', 'Sign in to use this model.');
    }
    const want = Math.ceil(estimateCost(model, inputTokens, model.maxOutput) * RESERVE_MARGIN);
    const min = Math.ceil(estimateCost(model, inputTokens, MIN_OUTPUT_TOKENS) * RESERVE_MARGIN);
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
      const affordable = hold.amount / RESERVE_MARGIN - estimateCost(model, inputTokens, 0);
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
          signal: upstream.signal,
          onDelta: delta => {
            outputChars += (delta.content?.length ?? 0) + (delta.reasoning?.length ?? 0);
            send('delta', { c: delta.content, r: delta.reasoning });
          },
        });
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
            : estimateCost(model, usage?.promptTokens || inputTokens, usage?.completionTokens || Math.ceil(outputChars / 3.5));
          const result = await settleCredits(db, identity.userId, holdId, outputChars === 0 && failure ? 0 : actual, `chat:${model.id}`, randomUUID());
          charged = result.charged;
          balance = result.balance;
        } else if (mode === 'free' && failure && outputChars === 0) {
          await refundFreeMessage(db, freeKeys);
        }
        if (mode === 'free' && identity.userId) balance = await getBalance(db, identity.userId);
      } catch (error) {
        console.error('[chat] settle', error);
      }

      if (failure) send('error', { error: failure.code, message: failure.message });
      else {
        send('done', {
          charged: toCredits(charged),
          balance: balance === null ? null : toCredits(balance),
          freeRemaining: isFreeModel(model) ? await freeRemaining(db, freeKeys, freeLimits).catch(() => null) : null,
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

function validateMessages(input: unknown): ChatMessage[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_MESSAGES) {
    throw new HttpError(400, 'bad_messages', 'Send between 1 and 100 messages.');
  }
  let chars = 0;
  const messages = input.map(raw => {
    const message = raw as Partial<ChatMessage>;
    if (!['system', 'user', 'assistant'].includes(message.role ?? '') || typeof message.content !== 'string') {
      throw new HttpError(400, 'bad_messages', 'Each message needs a role and text.');
    }
    chars += message.content.length;
    return { role: message.role!, content: message.content };
  });
  if (chars > MAX_CHARS) throw new HttpError(413, 'too_long', 'This conversation is too long. Start a new chat.');
  return messages;
}
