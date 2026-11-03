// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { readEvents } from '../../src/cloud/sse';

// Sandbox configuration, with a model that takes a long time before its first word.
vi.stubEnv('OPENROUTER_API_KEY', '');
vi.stubEnv('STRIPE_SECRET_KEY', '');
vi.stubEnv('RESEND_API_KEY', '');

const slow = vi.hoisted(() => ({ waiting: false, answer: () => {} }));
vi.mock('../openrouter.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../openrouter.js')>()),
  streamChat: async (_model: unknown, _messages: unknown, options: { onDelta: (delta: { content?: string }) => void }) => {
    await new Promise<void>(resolve => {
      slow.waiting = true;
      slow.answer = resolve;
    });
    options.onDelta({ content: 'A late reply.' });
    return { promptTokens: 1, completionTokens: 1, costUsd: null, toolCalls: [], finishReason: 'stop', searches: 0, sources: [] };
  },
}));

let handleApi: typeof import('../routes.js').handleApi;
beforeAll(async () => {
  ({ handleApi } = await import('../routes.js'));
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => vi.useRealTimers());

const call = (path: string, body?: unknown) =>
  handleApi(new Request(`http://localhost/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', 'x-quo-device': randomUUID(), 'x-forwarded-for': '10.0.0.2', 'sec-fetch-site': 'same-origin' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), path);

it('keeps a slow reply’s connection open with comments the app’s reader skips', async () => {
  const { defaultModel } = await (await call('models')).json();
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  const response = await call('chat', { model: defaultModel, messages: [{ role: 'user', content: 'Hello there' }] });
  while (!slow.waiting) await new Promise(resolve => setTimeout(resolve, 5));
  // 45 s of silence from the model: two keep-alives, well inside a proxy's 100 s.
  vi.advanceTimersByTime(45_000);
  slow.answer();
  const text = await response.text();
  expect(text.match(/^: keep-alive$/gm)).toHaveLength(2);

  const events: string[] = [];
  await readEvents(new Response(text), event => events.push(event));
  expect(events).toEqual(['delta', 'done']);
  // Stopped once the reply was done.
  expect(vi.getTimerCount()).toBe(0);
});
