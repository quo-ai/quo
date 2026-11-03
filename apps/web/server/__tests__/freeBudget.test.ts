// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { beforeAll, expect, it, vi } from 'vitest';
import { recordCost } from '../costs.js';
import { getDb } from '../db.js';
import { config } from '../env.js';
import { freeBudgetReached } from '../freeTier.js';

// Sandbox: a stand-in model answers, nothing is paid.
vi.stubEnv('OPENROUTER_API_KEY', '');
vi.stubEnv('STRIPE_SECRET_KEY', '');
vi.stubEnv('RESEND_API_KEY', '');

let handleApi: typeof import('../routes.js').handleApi;
beforeAll(async () => {
  ({ handleApi } = await import('../routes.js'));
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

const call = (path: string, body: unknown) =>
  handleApi(new Request(`http://localhost/api/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-quo-device': randomUUID(), 'x-forwarded-for': '10.0.0.7', 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify(body),
  }), path);
const answer = async (response: Response) => ({ status: response.status, ...(response.headers.get('content-type')?.includes('json') ? await response.json() : {}) });

it('pauses free use for everyone once the day’s free cost reaches the budget, and only the free tier', async () => {
  const db = await getDb();
  const day = new Date('2030-01-02T12:00:00Z');
  expect(await freeBudgetReached(db, day)).toBe(false);
  await recordCost(db, 'chat:paid', { usd: 50, now: day }); // paid use never counts
  await recordCost(db, 'chat:free', { usd: 3, now: day });
  expect(await freeBudgetReached(db, day)).toBe(false);
  await recordCost(db, 'image:free', { usd: 1.5, now: day });
  await recordCost(db, 'code:free', { usd: 0.5, now: day });
  expect(await freeBudgetReached(db, day)).toBe(true);
  expect(await freeBudgetReached(db, new Date('2030-01-03T00:00:01Z'))).toBe(false); // a new day
  const saved = config.freeDailyBudgetCents;
  config.freeDailyBudgetCents = 0; // no limit
  expect(await freeBudgetReached(db, day)).toBe(false);
  config.freeDailyBudgetCents = saved;
});

it('answers a free chat or image past the budget with its own message, not as the person’s own limit', async () => {
  const db = await getDb();
  const { defaultModel } = await (await handleApi(new Request('http://localhost/api/models'), 'models')).json();
  const first = await call('chat', { model: defaultModel, messages: [{ role: 'user', content: 'Hello' }] });
  expect(first.status).toBe(200);
  await first.text();
  await recordCost(db, 'chat:free', { usd: config.freeDailyBudgetCents / 100 });
  expect(await answer(await call('chat', { model: defaultModel, messages: [{ role: 'user', content: 'Hello again' }] }))).toMatchObject({ status: 429, error: 'free_budget' });
  expect(await answer(await call('image', { prompt: 'a red apple on a table' }))).toMatchObject({ status: 429, error: 'free_budget' });
});
