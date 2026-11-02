import { randomUUID } from 'node:crypto';
import { costToMillicredits } from './cloudModels.js';
import { getBalance, reserveCredits, settleCredits } from './credits.js';
import { getDb } from './db.js';
import { config, features } from './env.js';
import { noteCost } from './costs.js';
import { freeRemaining, refundFreeMessage, takeFree } from './freeTier.js';
import { HttpError, json, readJson } from './http.js';
import { freeSubject, identify } from './identity.js';
import { IMAGE_ASPECTS, IMAGE_DATA_URL, MAX_IMAGE_CHARS, MAX_IMAGE_PROMPT_CHARS, type ImageAspect } from '../shared/content.js';

/**
 * POST /api/image — one image from a prompt, through OpenRouter's image API. The prompt comes from the person's own
 * model (it writes a clear one from what they asked: src/images/), so this endpoint takes only that prompt, a shape,
 * and for a change to an earlier image that image. Nothing is stored.
 *
 *   { prompt, aspect?, edit? }  →  { image: data address, model: { id, name }, charged, balance, freeRemaining }
 *
 * A new image is made by the create model; a change to one by the edit model, which takes the earlier image as its
 * reference. The create model sometimes queues for a minute, so for credits after CREATE_MS the edit model (fast, and
 * good at new images too) makes it instead. Images come from a small daily allowance first, then from credits, held for
 * the dearest model that might make it and settled at what it cost. Free images cost Quo, so they stay on the cheap
 * model (no fallback, which costs about four times as much: a busy moment means "try again"), and a change, which only
 * the dearer edit model can make, counts as two of the day's free images.
 */

export const IMAGE_MODELS = {
  // Checked 2 Nov 2026 with one test image each: correct text on a sign, about $0.009, 8 s.
  create: { id: 'black-forest-labs/flux-3-image-klein', name: 'FLUX 3 Klein', holdUsd: 0.03, typicalUsd: 0.009 },
  // Takes a reference image and keeps what isn't asked to change: about $0.034, 6.5 s.
  edit: { id: 'google/gemini-3.1-flash-lite-image', name: 'Gemini 3.1 Flash Lite Image', holdUsd: 0.08, typicalUsd: 0.034 },
} as const;

type ImageModel = (typeof IMAGE_MODELS)[keyof typeof IMAGE_MODELS];

const MAX_REQUEST_BYTES = 2_500_000;
// Both attempts fit in 90 s: Cloudflare, in front of the server, closes a request that is silent for 100 s.
const CREATE_MS = 35_000;
const FALLBACK_MS = 50_000;

interface ImageRequest {
  prompt?: unknown;
  aspect?: unknown;
  edit?: unknown;
}

/** What OpenRouter sends back: images as base64, and the cost. */
interface ImageResponse {
  data?: { b64_json?: unknown; media_type?: unknown }[];
  usage?: { cost?: unknown };
}

export async function handleImage(request: Request): Promise<Response> {
  if (!features.cloud) throw new HttpError(503, 'cloud_unavailable', 'Making images isn’t available right now.');
  const body = await readJson<ImageRequest>(request, MAX_REQUEST_BYTES);
  const prompt = typeof body.prompt === 'string' ? body.prompt.replace(/[\u0000-\u0008\u000b-\u001f]/g, ' ').trim() : '';
  if (!prompt || prompt.length > MAX_IMAGE_PROMPT_CHARS) throw new HttpError(400, 'bad_prompt', 'Describe the image in a few sentences.');
  const aspect: ImageAspect = IMAGE_ASPECTS.includes(body.aspect as ImageAspect) ? (body.aspect as ImageAspect) : '1:1';
  if (body.edit !== undefined && (typeof body.edit !== 'string' || body.edit.length > MAX_IMAGE_CHARS || !IMAGE_DATA_URL.test(body.edit))) {
    throw new HttpError(400, 'bad_image', 'The image to change isn’t valid.');
  }
  const reference = typeof body.edit === 'string' ? body.edit : null;

  const db = await getDb();
  const identity = await identify(db, request);
  const freeKeys = { subject: `image:${freeSubject(identity)}`, ip: `image:${identity.ip}` };
  const freeLimits = { perSubject: config.freeDailyImages, perIp: config.freeDailyImagesPerIp };
  const freeUses = reference ? 2 : 1;
  const free = (await takeFree(db, freeKeys, freeLimits, { uses: freeUses })).ok;
  let attempts: [ImageModel, number][] = reference
    ? [[IMAGE_MODELS.edit, CREATE_MS + FALLBACK_MS]]
    : free ? [[IMAGE_MODELS.create, CREATE_MS + FALLBACK_MS]] : [[IMAGE_MODELS.create, CREATE_MS], [IMAGE_MODELS.edit, FALLBACK_MS]];
  let holdId: string | null = null;
  if (!free) {
    if (!identity.userId || !features.accounts) {
      const left = reference ? await freeRemaining(db, freeKeys, freeLimits).catch(() => 0) : 0;
      throw new HttpError(429, 'image_limit', left > 0
        ? 'Changing an image counts as two of the day’s free images, and you have one left. Ask for a new image instead.'
        : `You’ve made today’s ${config.freeDailyImages} free images. They come back tomorrow.`);
    }
    // Held for the dearest model that may make it. A balance that covers only the first model's hold gets that model
    // alone, for the whole time, instead of being refused: most images cost a fraction of the hold.
    const full = costToMillicredits(Math.max(...attempts.map(([model]) => model.holdUsd)));
    const least = costToMillicredits(attempts[0][0].holdUsd);
    const hold = await reserveCredits(db, identity.userId, full, least);
    if (!hold) throw new HttpError(402, 'insufficient_credits', 'You don’t have enough credits to make an image.');
    holdId = hold.id;
    if (hold.amount < full) attempts = [[attempts[0][0], CREATE_MS + FALLBACK_MS]];
  }

  let made: Made | null = null;
  let charged = 0;
  try {
    made = await firstImage(attempts, prompt, aspect, reference, request.signal);
  } finally {
    // Paid only for an image that was made, at what it really cost (the model's typical cost if OpenRouter didn't say).
    if (free && !made) await refundFreeMessage(db, freeKeys, undefined, freeUses).catch(() => {});
    if (holdId && identity.userId) {
      const actual = made ? costToMillicredits(made.costUsd ?? made.model.typicalUsd) : 0;
      charged = await settleCredits(db, identity.userId, holdId, actual, `image:${made?.model.id ?? 'failed'}`, randomUUID()).then(result => result.charged, error => {
        console.error('[image] settle', error);
        return 0;
      });
    }
  }
  await noteCost(db, free ? 'image:free' : 'image:paid', { usd: made.costUsd ?? made.model.typicalUsd, charged });
  return json({
    image: made.image,
    model: { id: made.model.id, name: made.model.name },
    // As chat reports them: what this cost with two decimals, and the balance with one.
    charged: Math.round(charged / 10) / 100,
    balance: identity.userId ? Math.round((await getBalance(db, identity.userId)) / 100) / 10 : null,
    freeRemaining: await freeRemaining(db, freeKeys, freeLimits).catch(() => null),
  });
}

interface Made {
  image: string;
  costUsd: number | null;
  model: ImageModel;
}

/** The image from the first model that makes it in its time. A refusal isn't tried again: another model would refuse too. */
async function firstImage(attempts: [ImageModel, number][], prompt: string, aspect: ImageAspect, reference: string | null, signal: AbortSignal): Promise<Made> {
  let failure: unknown = null;
  for (const [model, ms] of attempts) {
    if (signal.aborted) break;
    try {
      return { ...(await makeImage(model.id, prompt, aspect, reference, signal, ms)), model };
    } catch (error) {
      if (error instanceof HttpError && error.code === 'image_refused') throw error;
      failure = error;
    }
  }
  throw failure ?? new HttpError(502, 'image_failed', 'The image couldn’t be made. Try again.');
}

/** One image from OpenRouter, as a data address. In the sandbox (no OpenRouter key) a plain stand-in picture. */
async function makeImage(model: string, prompt: string, aspect: ImageAspect, reference: string | null, signal: AbortSignal, ms: number): Promise<{ image: string; costUsd: number | null }> {
  if (!config.openRouterKey) return { image: STAND_IN, costUsd: 0 };
  const timeout = AbortSignal.timeout(ms);
  let response: Response;
  try {
    response = await fetch('https://openrouter.ai/api/v1/images', {
      method: 'POST',
      signal: AbortSignal.any([signal, timeout]),
      headers: { authorization: `Bearer ${config.openRouterKey}`, 'content-type': 'application/json', 'http-referer': config.appUrl, 'x-title': 'Quo' },
      body: JSON.stringify({
        model,
        prompt,
        aspect_ratio: aspect,
        resolution: '1K',
        ...(reference ? { input_references: [{ type: 'image_url', image_url: { url: reference } }] } : {}),
        provider: { data_collection: 'deny' },
      }),
    });
  } catch (error) {
    console.error('[image] upstream', error instanceof Error ? error.message : error);
    throw new HttpError(502, 'image_failed', timeout.aborted ? 'The image took too long. Try again.' : 'The image couldn’t be made. Try again.');
  }
  const answer = (await response.json().catch(() => ({}))) as ImageResponse & { error?: { message?: unknown } };
  const data = answer.data?.[0];
  const media = typeof data?.media_type === 'string' && /^image\/(png|jpeg|webp)$/.test(data.media_type) ? data.media_type : 'image/png';
  if (!response.ok || typeof data?.b64_json !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(data.b64_json)) {
    console.error('[image] upstream', response.status, String(answer.error?.message ?? '').slice(0, 200));
    // A prompt the model's provider refuses says so; anything else is a plain failure.
    const refused = response.status === 400 && /safety|policy|moderat|blocked|refus/i.test(String(answer.error?.message ?? ''));
    throw refused ? new HttpError(422, 'image_refused', 'The image model refused this request. Try describing it differently.') : new HttpError(502, 'image_failed', 'The image couldn’t be made. Try again.');
  }
  const cost = typeof answer.usage?.cost === 'number' && Number.isFinite(answer.usage.cost) ? answer.usage.cost : null;
  return { image: `data:${media};base64,${data.b64_json}`, costUsd: cost };
}

// A one-pixel picture: what the sandbox sends instead of a real image.
const STAND_IN = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
