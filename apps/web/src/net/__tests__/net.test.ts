import { beforeEach, describe, expect, it } from 'vitest';
import type { ModelChoice } from '../../models';
import { installLocalStorage } from '../../providers/__tests__/helpers';
import { needsInternet } from '../fallback';
import { fallbackSetting, setFallbackSetting } from '../settings';
import { reachable } from '../status';

installLocalStorage();
beforeEach(() => localStorage.clear());

const answer = (status: number, body = '{}') => (async () => new Response(body, { status })) as unknown as typeof fetch;

describe('whether the internet can be reached', () => {
  it('is yes for any answer from Quo’s address, even an error page', async () => {
    for (const status of [200, 404, 500, 502]) expect(await reachable(answer(status)), String(status)).toBe(true);
  });

  it('is no when the connection fails, or when the desktop app says it is offline', async () => {
    expect(await reachable((async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch)).toBe(false);
    expect(await reachable(answer(503, JSON.stringify({ error: 'offline', message: 'x' })))).toBe(false);
    expect(await reachable(answer(503, 'maintenance'))).toBe(true);
  });
});

describe('which models need the internet', () => {
  const own = (baseUrl: string, custom: boolean) => ({ kind: 'own', model: { id: 'x', agent: true }, provider: { id: 'p', name: 'P', protocol: 'openai', baseUrl, usage: false, custom } }) as unknown as ModelChoice;

  it('cloud models and providers do; offline models and servers on this computer or network don’t', () => {
    expect(needsInternet({ kind: 'cloud', model: { id: 'c' } } as unknown as ModelChoice)).toBe(true);
    expect(needsInternet(own('https://api.openai.com/v1', false))).toBe(true);
    expect(needsInternet(own('https://llm.example.com/v1', true))).toBe(true);
    expect(needsInternet(own('http://localhost:11434/v1', true))).toBe(false);
    expect(needsInternet(own('http://192.168.1.5:8000/v1', true))).toBe(false);
    expect(needsInternet({ kind: 'local', model: { id: 'l' } } as unknown as ModelChoice)).toBe(false);
    expect(needsInternet(null)).toBe(false);
  });
});

describe('what to do when a cloud model can’t be used', () => {
  it('switches by default, and remembers the choice', () => {
    expect(fallbackSetting()).toBe('switch');
    setFallbackSetting('ask');
    expect(fallbackSetting()).toBe('ask');
    expect(localStorage.getItem('quo.fallback')).toBe('ask');
  });
});
