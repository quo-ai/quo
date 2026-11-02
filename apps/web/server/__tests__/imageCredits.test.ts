// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { MILLI } from '../credits.js';
import { getDb } from '../db.js';

// Sandbox sign-in (codes come back in the answer), no free images (set below), and a stand-in OpenRouter for images.
// Before any import reads the settings (imports run first): sandbox sign-in, never a real email or purchase.
vi.hoisted(() => {
  for (const name of ['OPENROUTER_API_KEY', 'PADDLE_API_KEY', 'RESEND_API_KEY']) process.env[name] = '';
});

let handleApi: typeof import('../routes.js').handleApi;
let config: typeof import('../env.js').config;
beforeAll(async () => {
  ({ handleApi } = await import('../routes.js'));
  ({ config } = await import('../env.js'));
  config.freeDailyImages = 0; // every image here is paid for
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  config.openRouterKey = null;
});

async function signedIn() {
  const email = `${randomUUID()}@example.com`;
  let cookie = '';
  const call = async (path: string, body: unknown) => {
    const response = await handleApi(new Request(`http://localhost/api/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-quo-device': randomUUID(), 'x-forwarded-for': '10.0.0.7', 'sec-fetch-site': 'same-origin', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }), path);
    const set = response.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return response;
  };
  const { devCode } = await (await call('auth/start', { email })).json();
  await call('auth/verify', { email, code: devCode });
  const db = await getDb();
  const [{ id }] = await db.query<{ id: string }>('select id from users where email = $1', [email]);
  const setCredits = (credits: number) => db.query('update credit_grants set remaining = $2 where user_id = $1', [id, credits * MILLI]);
  return { call, setCredits };
}

/** OpenRouter's image API, stood in for: each model answers as `answers` says, and every call is recorded. */
function openRouter(answers: Record<string, { cost?: number } | 'busy'>) {
  config.openRouterKey = 'test-key';
  const asked: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    const model = JSON.parse(String(init?.body)).model as string;
    asked.push(model);
    const answer = answers[model];
    if (!answer || answer === 'busy') return new Response(JSON.stringify({ error: { message: 'busy' } }), { status: 503 });
    return new Response(JSON.stringify({ data: [{ b64_json: 'iVBORw0KGgo=', media_type: 'image/png' }], ...(answer.cost === undefined ? {} : { usage: { cost: answer.cost } }) }), { status: 200 });
  });
  return asked;
}

const FLUX = 'black-forest-labs/flux-3-image-klein';
const GEMINI = 'google/gemini-3.1-flash-lite-image';

it('with credits for the first model only, a paid image is still made by it (no dearer fallback), and charged what it cost', async () => {
  const me = await signedIn();
  await me.setCredits(10); // under the fallback's hold (16), over the first model's (6)
  const failed = openRouter({ [FLUX]: 'busy', [GEMINI]: { cost: 0.034 } });
  const refused = await me.call('image', { prompt: 'A red fox in snow' });
  expect(((await refused.json()) as { error: string }).error).toBe('image_failed');
  expect(failed).toEqual([FLUX]);

  openRouter({ [FLUX]: { cost: 0.009 } });
  const made = await (await me.call('image', { prompt: 'A red fox in snow' })).json() as { charged: number; balance: number };
  expect(made).toMatchObject({ charged: 1.8, balance: 8.2 });
});

it('with enough credits, a busy first model falls back, charged the fallback’s own cost; an unknown cost is the typical one', async () => {
  const me = await signedIn();
  await me.setCredits(25);
  const asked = openRouter({ [FLUX]: 'busy', [GEMINI]: { cost: 0.034 } });
  const made = await (await me.call('image', { prompt: 'A lighthouse at dusk' })).json() as { charged: number; balance: number; model: { id: string } };
  expect(asked).toEqual([FLUX, GEMINI]);
  expect(made).toMatchObject({ charged: 6.8, balance: 18.2, model: { id: GEMINI } });

  openRouter({ [FLUX]: {} });
  expect(await (await me.call('image', { prompt: 'A lighthouse at dawn' })).json()).toMatchObject({ charged: 1.8, balance: 16.4 });
});

it('a change to an image needs the change model’s hold, and too few credits are refused before anything is made', async () => {
  const me = await signedIn();
  await me.setCredits(10);
  const asked = openRouter({ [GEMINI]: { cost: 0.034 } });
  const response = await me.call('image', { prompt: 'Make it night', edit: 'data:image/png;base64,iVBORw0KGgo=' });
  expect(response.status).toBe(402);
  expect(asked).toEqual([]);
});
