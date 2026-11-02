// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';

// Sandbox: no OpenRouter key, so a stand-in picture; two free images a day.
vi.stubEnv('OPENROUTER_API_KEY', '');
vi.stubEnv('PADDLE_API_KEY', '');
vi.stubEnv('RESEND_API_KEY', '');
vi.stubEnv('FREE_DAILY_IMAGES', '2');
vi.stubEnv('FREE_DAILY_IMAGES_PER_IP', '50');

let handleApi: typeof import('../routes.js').handleApi;
beforeAll(async () => {
  ({ handleApi } = await import('../routes.js'));
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

const device = randomUUID();
const make = (body: unknown, who = device) => handleApi(new Request('http://localhost/api/image', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-quo-device': who, 'x-forwarded-for': '10.0.0.3', 'sec-fetch-site': 'same-origin' },
  body: JSON.stringify(body),
}), 'image');
const errorOf = async (response: Promise<Response>) => {
  const answer = await response;
  return answer.ok ? null : ((await answer.json()) as { error?: string }).error;
};

describe('making images in the cloud', () => {
  it('makes an image from a prompt, and says how many free ones are left', async () => {
    const answer = await make({ prompt: 'A red fox in fresh snow at dawn, photographic', aspect: '3:2' });
    expect(answer.status).toBe(200);
    const body = (await answer.json()) as { image: string; model: { id: string }; freeRemaining: number };
    expect(body.image).toMatch(/^data:image\/png;base64,/);
    expect(body.model.id).toBe('black-forest-labs/flux-3-image-klein');
    expect(body.freeRemaining).toBe(1);
  });

  it('a change to an image goes to the model that takes a reference image', async () => {
    const answer = await make({ prompt: 'Make it night', edit: 'data:image/png;base64,iVBORw0KGgo=' }, randomUUID());
    expect(((await answer.json()) as { model: { id: string } }).model.id).toBe('google/gemini-3.1-flash-lite-image');
  });

  it('a change counts as two of the day’s free images, and is refused with a plain reason when only one is left', async () => {
    const changer = randomUUID();
    const change = await make({ prompt: 'Make it night', edit: 'data:image/png;base64,iVBORw0KGgo=' }, changer);
    expect(((await change.json()) as { freeRemaining: number }).freeRemaining).toBe(0);
    expect(await errorOf(make({ prompt: 'A new one' }, changer))).toBe('image_limit');

    const oneLeft = randomUUID();
    await make({ prompt: 'A lighthouse' }, oneLeft);
    const refused = await make({ prompt: 'Make it night', edit: 'data:image/png;base64,iVBORw0KGgo=' }, oneLeft);
    expect(refused.status).toBe(429);
    expect(((await refused.json()) as { message: string }).message).toMatch(/counts as two/);
    expect((await make({ prompt: 'A new one instead' }, oneLeft)).status).toBe(200);
  });

  it('a free image stays on the cheap model: no retry on the dearer one, and a failure gives the free image back', async () => {
    const { config } = await import('../env.js');
    config.openRouterKey = 'test-key';
    const asked: string[] = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      asked.push(JSON.parse(String(init?.body)).model);
      return new Response(JSON.stringify({ error: { message: 'busy' } }), { status: 503 });
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const who = randomUUID();
      expect(await errorOf(make({ prompt: 'A red fox' }, who))).toBe('image_failed');
      expect(asked).toEqual(['black-forest-labs/flux-3-image-klein']);
      fetchSpy.mockRestore();
      config.openRouterKey = null;
      // Both free images are still there.
      expect(((await (await make({ prompt: 'A red fox' }, who)).json()) as { freeRemaining: number }).freeRemaining).toBe(1);
    } finally {
      fetchSpy.mockRestore();
      config.openRouterKey = null;
    }
  });

  it('stops at the daily free images for someone without credits', async () => {
    const who = randomUUID();
    await make({ prompt: 'one' }, who);
    await make({ prompt: 'two' }, who);
    expect(await errorOf(make({ prompt: 'three' }, who))).toBe('image_limit');
  });

  it('takes a prompt of a sensible length, and an image to change only as image data', async () => {
    expect(await errorOf(make({ prompt: '' }))).toBe('bad_prompt');
    expect(await errorOf(make({ prompt: 'x'.repeat(4001) }))).toBe('bad_prompt');
    for (const edit of ['https://example.com/a.png', 'data:text/html;base64,PGgx', 'file:///etc/passwd', 42]) {
      expect(await errorOf(make({ prompt: 'Make it night', edit }, randomUUID()))).toBe('bad_image');
    }
  });

  it('an unknown shape becomes square', async () => {
    expect((await make({ prompt: 'A lighthouse', aspect: '99:1' }, randomUUID())).status).toBe(200);
  });
});
