import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installLocalStorage } from '../../providers/__tests__/helpers';

// A copy built to run without Quo's server (npm run build:standalone, standalone.ts).
beforeEach(() => installLocalStorage());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function load(mode: string) {
  vi.stubEnv('MODE', mode);
  vi.resetModules();
  return import('../api');
}

describe('a copy without Quo’s server', () => {
  it('never calls Quo’s server, and says where the full app is', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { apiFetch, api } = await load('standalone');
    for (const call of [() => apiFetch('models'), () => api('chat', { body: { x: 1 } }), () => apiFetch('auth/start', { body: {} }), () => apiFetch('image', { body: {} })]) {
      await expect(call()).rejects.toMatchObject({ status: 503, code: 'setup_required', message: expect.stringContaining('app.quo.computer') });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('is off in every other build', async () => {
    const fetchSpy = vi.fn(async (..._args: unknown[]) => new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const { api } = await load('production');
    await expect(api('models')).resolves.toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledOnce();
  });
});
