// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { READ_ONLY_TOOLS } from '../../shared/agentTools.js';

// Sandbox configuration: the stand-in model answers.
vi.stubEnv('OPENROUTER_API_KEY', '');
vi.stubEnv('STRIPE_SECRET_KEY', '');
vi.stubEnv('RESEND_API_KEY', '');

let handleApi: typeof import('../routes.js').handleApi;

beforeAll(async () => {
  ({ handleApi } = await import('../routes.js'));
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

const device = randomUUID();
const call = (method: string, path: string, body?: unknown) =>
  handleApi(new Request(`http://localhost/api/${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-quo-device': device, 'x-forwarded-for': '10.0.0.2', 'sec-fetch-site': 'same-origin' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), path);

const IMAGE = `data:image/jpeg;base64,${'A'.repeat(64)}`;
const withImages = (urls: string[], text = 'What is in this photo?') => [{ role: 'user', content: [...urls.map(url => ({ type: 'image_url', image_url: { url } })), { type: 'text', text }] }];
const status = async (response: Promise<Response>) => (await response).status;
/** The error code a refused request answers with, or null when it was taken. */
async function code(response: Promise<Response>) {
  const answer = await response;
  if (answer.ok) return null;
  return ((await answer.json()) as { error?: string }).error ?? null;
}

describe('images in cloud chats', () => {
  it('lists which models read images', async () => {
    const { models } = await (await call('GET', 'models')).json() as { models: { id: string; vision: boolean }[] };
    expect(models.find(model => model.id === 'openai/gpt-6-luna')?.vision).toBe(true);
    expect(models.find(model => model.id === 'z-ai/glm-5.3-prime')?.vision).toBe(false);
  });

  it('takes a photo with a message to a model that reads images', async () => {
    expect(await status(call('POST', 'chat', { model: 'openai/gpt-6-luna', messages: withImages([IMAGE]) }))).toBe(200);
  });

  it('refuses images for a model that can’t read them', async () => {
    expect(await code(call('POST', 'chat', { model: 'deepseek/deepseek-v4-pro-0813', messages: withImages([IMAGE]) }))).toBe('no_images');
  });

  it('takes only data addresses of images, never a web address or another kind of file', async () => {
    for (const url of ['https://example.com/cat.jpg', 'data:text/html;base64,PGgxPg==', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/jpeg;base64,not base64']) {
      expect(await code(call('POST', 'chat', { model: 'openai/gpt-6-luna', messages: withImages([url]) }))).toBe('bad_messages');
    }
  });

  it('takes a few images at a time', async () => {
    expect(await code(call('POST', 'chat', { model: 'openai/gpt-6-luna', messages: withImages([IMAGE, IMAGE, IMAGE, IMAGE, IMAGE]) }))).toBe('too_many_images');
  });

  it('keeps images out of Code mode, whose messages are text', async () => {
    expect(await code(call('POST', 'chat', { model: 'anthropic/claude-sonnet-5.5', agent: { tools: [...READ_ONLY_TOOLS] }, messages: withImages([IMAGE]) }))).toBe('bad_messages');
  });
});
