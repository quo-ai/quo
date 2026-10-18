// @vitest-environment node
import { createHmac, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Sandbox configuration: stand-in model, logged codes, simulated purchases.
vi.stubEnv('OPENROUTER_API_KEY', '');
vi.stubEnv('PADDLE_API_KEY', '');
vi.stubEnv('RESEND_API_KEY', '');
vi.stubEnv('FREE_DAILY_MESSAGES', '2');
vi.stubEnv('FREE_DAILY_MESSAGES_PER_IP', '50');

let handleApi: typeof import('../routes.js').handleApi;
let verifyPaddleSignature: typeof import('../billing.js').verifyPaddleSignature;

beforeAll(async () => {
  ({ handleApi } = await import('../routes.js'));
  ({ verifyPaddleSignature } = await import('../billing.js'));
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

const device = randomUUID();
let cookie = '';

function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  return handleApi(new Request(`http://localhost/api/${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-quo-device': device, 'x-forwarded-for': '10.0.0.1', 'sec-fetch-site': 'same-origin', ...(cookie ? { cookie } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), path.split('?')[0]);
}

async function events(response: Response) {
  const text = await response.text();
  return text.split('\n\n').filter(Boolean).map(block => {
    const [eventLine, dataLine] = block.split('\n');
    return { event: eventLine.replace('event: ', ''), data: JSON.parse(dataLine.replace('data: ', '')) };
  });
}

const ask = (model: string) => call('POST', 'chat', { model, messages: [{ role: 'user', content: 'Hello there' }] });

describe('API (sandbox)', () => {
  let freeModel = '';

  it('lists cloud models with a free default', async () => {
    const catalog = await (await call('GET', 'models')).json();
    freeModel = catalog.defaultModel;
    const def = catalog.models.find((m: { id: string }) => m.id === freeModel);
    expect(def.free).toBe(true);
    expect(catalog.models.some((m: { free: boolean; creditsPerMessage: number }) => !m.free && m.creditsPerMessage > 0)).toBe(true);
  });

  it('streams free replies anonymously until the daily allowance is used', async () => {
    const first = await events(await ask(freeModel));
    expect(first.some(e => e.event === 'delta')).toBe(true);
    expect(first.at(-1)).toMatchObject({ event: 'done', data: { charged: 0, freeRemaining: 1 } });
    await (await ask(freeModel)).text();
    const third = await ask(freeModel);
    expect(third.status).toBe(429);
    expect((await third.json()).error).toBe('free_limit');
  });

  it('requires sign-in for premium models', async () => {
    const response = await ask('anthropic/claude-sonnet-5.5');
    expect(response.status).toBe(401);
  });

  it('signs in with an emailed code and grants trial credits', async () => {
    const start = await (await call('POST', 'auth/start', { email: 'Test@Example.com' })).json();
    expect(start.devCode).toMatch(/^\d{6}$/);
    const wrong = await call('POST', 'auth/verify', { email: 'test@example.com', code: start.devCode === '000000' ? '111111' : '000000' });
    expect(wrong.status).toBe(400);
    const verify = await call('POST', 'auth/verify', { email: 'test@example.com', code: start.devCode });
    expect(verify.status).toBe(200);
    cookie = verify.headers.get('set-cookie')!.split(';')[0];
    expect(await verify.json()).toMatchObject({ user: { email: 'test@example.com' }, plan: 'free', credits: 25 });
  });

  it('charges credits for premium models and reports the balance', async () => {
    const stream = await events(await ask('anthropic/claude-sonnet-5.5'));
    const done = stream.at(-1)!;
    expect(done.event).toBe('done');
    expect(done.data.charged).toBeGreaterThan(0);
    // The balance is shown to a tenth of a credit and the charge to a hundredth.
    expect(Math.abs(done.data.balance - (25 - done.data.charged))).toBeLessThan(0.1);
  });

  it('completes a simulated Pro purchase with monthly credits', async () => {
    const checkout = await (await call('POST', 'billing/checkout', { product: 'pro_monthly' })).json();
    expect(checkout.url).toContain('/api/billing/dev-complete');
    const complete = await call('GET', checkout.url.replace('/api/', ''), undefined);
    expect(complete.status).toBe(302);
    const me = await (await call('GET', 'me')).json();
    expect(me.plan).toBe('pro');
    expect(me.credits).toBeGreaterThan(1000);
  });

  it('blocks cross-site POSTs', async () => {
    const response = await call('POST', 'auth/signout', {}, { 'sec-fetch-site': 'cross-site' });
    expect(response.status).toBe(403);
  });

  it('verifies Paddle webhook signatures', () => {
    const body = '{"event_id":"evt_1"}';
    const ts = Math.floor(Date.now() / 1000);
    const h1 = createHmac('sha256', 'secret').update(`${ts}:${body}`).digest('hex');
    expect(verifyPaddleSignature(`ts=${ts};h1=${h1}`, body, 'secret')).toBe(true);
    expect(verifyPaddleSignature(`ts=${ts};h1=${h1}`, body + ' ', 'secret')).toBe(false);
    expect(verifyPaddleSignature(`ts=${ts - 600};h1=${h1}`, body, 'secret')).toBe(false);
  });
});

describe('API (production, services not set up yet)', () => {
  // Visible in the app, but each answers with a clear setup_required error.
  let config: typeof import('../env.js').config;

  beforeAll(async () => {
    ({ config } = await import('../env.js'));
    config.production = true;
    config.resendKey = null;
    config.paddle.apiKey = null;
    config.openRouterKey = 'test-key';
  });
  afterAll(() => {
    config.production = false;
    config.openRouterKey = null;
  });

  it('still lists every cloud model', async () => {
    const catalog = await (await call('GET', 'models')).json();
    expect(catalog.models.length).toBeGreaterThan(3);
  });

  it('reports what is set up', async () => {
    const me = await (await call('GET', 'me')).json();
    expect(me.features).toEqual({ cloud: true, accounts: false, billing: false });
  });

  it('answers paid models, sign-in and purchases with setup_required', async () => {
    const catalog = await (await call('GET', 'models')).json();
    const paid = catalog.models.find((m: { free: boolean }) => !m.free).id;
    for (const response of [
      await ask(paid),
      await call('POST', 'auth/start', { email: 'someone@example.com' }),
      await call('POST', 'auth/verify', { email: 'someone@example.com', code: '123456' }),
      await call('POST', 'billing/checkout', { product: 'pack_1000' }),
      await call('POST', 'billing/portal', {}),
    ]) {
      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body.error).toBe('setup_required');
      expect(body.message).toMatch(/set up|coming soon/i);
    }
  });

  it('hides cloud models entirely when there is no OpenRouter key', async () => {
    config.openRouterKey = null;
    const catalog = await (await call('GET', 'models')).json();
    expect(catalog.models).toEqual([]);
    const chat = await ask('openai/gpt-6-luna');
    expect(chat.status).toBe(503);
    expect((await chat.json()).error).toBe('cloud_unavailable');
    config.openRouterKey = 'test-key';
  });
});
