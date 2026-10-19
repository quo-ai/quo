// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.stubEnv('OPENROUTER_API_KEY', '');
vi.stubEnv('PADDLE_API_KEY', '');
vi.stubEnv('RESEND_API_KEY', '');
vi.stubEnv('FREE_DAILY_SEARCHES', '5');

const asked: { web?: unknown }[] = [];
let refuse = 400;
vi.mock('../openrouter.js', async original => {
  const real = await original<typeof import('../openrouter.js')>();
  return {
    ...real,
    streamChat: async (_model: unknown, _messages: unknown, options: { web?: unknown; onDelta: (d: { content: string }) => void }) => {
      asked.push({ web: options.web });
      if (options.web && refuse) throw new real.UpstreamError(refuse, 'tool not supported');
      options.onDelta({ content: 'answer' });
      return { promptTokens: 10, completionTokens: 1, costUsd: null, toolCalls: [], finishReason: 'stop', searches: 0, sources: [] };
    },
  };
});

let handleApi: typeof import('../routes.js').handleApi;
beforeAll(async () => {
  ({ handleApi } = await import('../routes.js'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

async function reply(id: string) {
  const headers = { 'content-type': 'application/json', 'x-quo-device': id, 'x-forwarded-for': '10.0.0.9', 'sec-fetch-site': 'same-origin' };
  const catalog = await (await handleApi(new Request('http://localhost/api/models', { headers }), 'models')).json();
  const response = await handleApi(new Request('http://localhost/api/chat', { method: 'POST', headers, body: JSON.stringify({ model: catalog.defaultModel, messages: [{ role: 'user', content: 'news today?' }], web: true }) }), 'chat');
  const text = await response.text();
  return { text, done: JSON.parse(text.split('event: done\ndata: ')[1]?.split('\n')[0] ?? 'null') };
}

describe('a model that won’t take the search tool', () => {
  it('still answers, asked once more without it, and the search is not counted', async () => {
    asked.length = 0;
    const { text, done } = await reply(randomUUID());
    expect(asked.map(a => Boolean(a.web))).toEqual([true, false]);
    expect(text).toContain('answer');
    expect(text).not.toContain('event: error');
    expect(done).toMatchObject({ web: 'not_needed', webRemaining: 5 });
  });

  it('is not retried for other failures, which are reported as before', async () => {
    refuse = 502;
    asked.length = 0;
    const { text } = await reply(randomUUID());
    expect(asked).toHaveLength(1);
    expect(text).toContain('event: error');
    refuse = 400;
  });
});
