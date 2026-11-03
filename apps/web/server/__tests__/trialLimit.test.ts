// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { beforeAll, expect, it, vi } from 'vitest';
import { TRIALS_PER_ADDRESS } from '../auth.js';

// Sandbox: sign-in codes come back in the answer.
vi.stubEnv('OPENROUTER_API_KEY', '');
vi.stubEnv('STRIPE_SECRET_KEY', '');
vi.stubEnv('RESEND_API_KEY', '');

let handleApi: typeof import('../routes.js').handleApi;
beforeAll(async () => {
  ({ handleApi } = await import('../routes.js'));
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

const post = (path: string, body: unknown, ip: string) => handleApi(new Request(`http://localhost/api/${path}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-quo-device': randomUUID(), 'x-forwarded-for': ip, 'sec-fetch-site': 'same-origin' },
  body: JSON.stringify(body),
}), path);
const signIn = async (email: string, ip: string) => {
  const { devCode } = await (await post('auth/start', { email }, ip)).json();
  return (await (await post('auth/verify', { email, code: devCode }, ip)).json()).credits as number;
};

it('gives a few new trials a day from one internet address; one held back comes at a later sign-in elsewhere', async () => {
  const ip = '10.66.0.1';
  for (let i = 0; i < TRIALS_PER_ADDRESS; i++) expect(await signIn(`farm${i}@example.com`, ip)).toBe(25);
  expect(await signIn('farm-extra@example.com', ip)).toBe(0);
  expect(await signIn('farm0@example.com', ip)).toBe(25); // signing in again costs no new trial and keeps the old one
  expect(await signIn('farm-extra@example.com', '10.66.0.2')).toBe(25);
});
