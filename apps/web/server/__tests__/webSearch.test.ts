// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.stubEnv('OPENROUTER_API_KEY', '');
vi.stubEnv('PADDLE_API_KEY', '');
vi.stubEnv('RESEND_API_KEY', '');
vi.stubEnv('FREE_DAILY_MESSAGES', '20');
vi.stubEnv('FREE_DAILY_MESSAGES_PER_IP', '50');
vi.stubEnv('FREE_DAILY_SEARCHES', '2');
vi.stubEnv('FREE_DAILY_SEARCHES_PER_IP', '50');

let handleApi: typeof import('../routes.js').handleApi;
let plugin: typeof import('../webSearch.js').webPlugin;
beforeAll(async () => {
  ({ handleApi } = await import('../routes.js'));
  ({ webPlugin: plugin } = await import('../webSearch.js'));
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

const device = randomUUID();
let cookie = '';

const call = (path: string, body: unknown, id = device) => handleApi(new Request(`http://localhost/api/${path}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-quo-device': id, 'x-forwarded-for': '10.0.0.7', 'sec-fetch-site': 'same-origin', ...(cookie ? { cookie } : {}) },
  body: JSON.stringify(body),
}), path);

async function reply(model: string, extra: Record<string, unknown> = {}, id = device) {
  const response = await call('chat', { model, messages: [{ role: 'user', content: 'What happened today?' }], ...extra }, id);
  const events = (await response.text()).split('\n\n').filter(Boolean).map(block => {
    const [eventLine, dataLine] = block.split('\n');
    return { event: eventLine.replace('event: ', ''), data: JSON.parse(dataLine.replace('data: ', '')) };
  });
  return { status: response.status, text: events.filter(e => e.event === 'delta').map(e => e.data.c ?? '').join(''), done: events.find(e => e.event === 'done')?.data };
}

describe('web search in cloud chat', () => {
  let free = '';
  beforeAll(async () => {
    const catalog = await (await handleApi(new Request('http://localhost/api/models', { headers: { 'x-quo-device': device } }), 'models')).json();
    free = catalog.defaultModel;
  });

  it('asks OpenRouter for one search with a fixed engine, so the price is known', () => {
    expect(plugin()).toEqual({ id: 'web', engine: 'exa', max_results: 5 });
  });

  it('a plain message uses no search, and takes none from the allowance', async () => {
    const plain = await reply(free);
    expect(plain.done).toMatchObject({ web: null, webRemaining: null });
    expect(plain.text).not.toContain('Web search was on');
    expect((await reply(free, { web: true })).done).toMatchObject({ web: 'searched', webRemaining: 1 });
  });

  it('the free model has a small daily allowance of searches, then answers without one and says so', async () => {
    const second = await reply(free, { web: true });
    expect(second.done).toMatchObject({ web: 'searched', webRemaining: 0 });
    expect(second.text).toContain('Web search was on');
    const third = await reply(free, { web: true });
    expect(third.status).toBe(200);
    expect(third.text.length).toBeGreaterThan(0);
    expect(third.text).not.toContain('Web search was on');
    expect(third.done).toMatchObject({ web: 'limit', webRemaining: 0 });
    // Every message so far counted (this is the fifth), and one without a search still works.
    expect((await reply(free)).done.freeRemaining).toBe(20 - 5);
  });

  it('the allowance belongs to the device: another one has its own', async () => {
    expect((await reply(free, { web: true }, randomUUID())).done).toMatchObject({ web: 'searched', webRemaining: 1 });
  });

  it('only a boolean true asks for a search', async () => {
    for (const web of ['true', 1, 'yes', {}]) expect((await reply(free, { web }, randomUUID())).done.web).toBeNull();
  });

  it('on credits a search is paid for: the reply costs more than without one', async () => {
    const start = await (await call('auth/start', { email: 'search@example.com' })).json();
    const verify = await call('auth/verify', { email: 'search@example.com', code: start.devCode });
    cookie = verify.headers.get('set-cookie')!.split(';')[0];
    const model = 'anthropic/claude-sonnet-5.5';
    const without = await reply(model);
    const withSearch = await reply(model, { web: true });
    expect(withSearch.done.web).toBe('searched');
    expect(withSearch.done.webRemaining).toBeNull();
    // At least the search fee (0.007 USD = 1.4 credits) more.
    expect(withSearch.done.charged - without.done.charged).toBeGreaterThanOrEqual(1.4);
  });
});
