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
let tool: typeof import('../webSearch.js').webTool;
beforeAll(async () => {
  ({ handleApi } = await import('../routes.js'));
  ({ webTool: tool } = await import('../webSearch.js'));
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

const device = randomUUID();
let cookie = '';

const call = (path: string, body: unknown, id = device) => handleApi(new Request(`http://localhost/api/${path}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-quo-device': id, 'x-forwarded-for': '10.0.0.7', 'sec-fetch-site': 'same-origin', ...(cookie ? { cookie } : {}) },
  body: JSON.stringify(body),
}), path);

async function reply(model: string, extra: Record<string, unknown> = {}, id = device, question = 'What happened today?') {
  const response = await call('chat', { model, messages: [{ role: 'user', content: question }], ...extra }, id);
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

  it('offers the model OpenRouter’s search tool with a fixed engine and a cap, so the price is known and the model decides', () => {
    expect(tool(3)).toEqual({ type: 'openrouter:web_search', parameters: { engine: 'exa', max_results: 5, max_uses: 3 } });
  });

  it('a chat where searching isn’t allowed offers none, and takes none from the allowance', async () => {
    const plain = await reply(free);
    expect(plain.done).toMatchObject({ web: null, webRemaining: null });
    expect(plain.text).not.toContain('searched the web');
  });

  it('a message the model answers without searching gives the held search back', async () => {
    const id = randomUUID();
    const answered = await reply(free, { web: true }, id, 'Write a haiku about rain.');
    expect(answered.done).toMatchObject({ web: 'not_needed', webRemaining: 2 });
    expect(answered.text).not.toContain('searched the web');
    expect((await reply(free, { web: true }, id)).done).toMatchObject({ web: 'searched', webRemaining: 1 });
  });

  it('a search the model makes comes from the allowance', async () => {
    expect((await reply(free, { web: true })).done).toMatchObject({ web: 'searched', webRemaining: 1 });
  });

  it('the free model has a small daily allowance of searches, then answers without one and says so', async () => {
    const second = await reply(free, { web: true });
    expect(second.done).toMatchObject({ web: 'searched', webRemaining: 0 });
    expect(second.text).toContain('searched the web');
    const third = await reply(free, { web: true });
    expect(third.status).toBe(200);
    expect(third.text.length).toBeGreaterThan(0);
    expect(third.text).not.toContain('searched the web');
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

  it('on credits a search is paid for when made: the reply costs more than without one, and nothing more when not needed', async () => {
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
    expect(withSearch.done.charged - without.done.charged).toBeLessThan(2.8);
    const unneeded = await reply(model, { web: true }, device, 'What happened today?'.replace('today', 'in 1066'));
    expect(unneeded.done.web).toBe('not_needed');
    expect(unneeded.done.charged).toBeLessThan(without.done.charged + 1.4);
  });
});
