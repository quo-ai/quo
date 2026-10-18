import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesktopProviders, ProviderEvent } from '../../native';
import { NativeError } from '../../native';
import { browserEndpoints, browserKeys } from '../browserKeys';
import { chatWithProvider } from '../chat';
import { headersFor } from '../headers';
import { listProviderModels } from '../listing';
import { browserTransport, desktopTransport } from '../transport';
import { ANTHROPIC, CUSTOM, OPENAI, chopped, installLocalStorage, sse, streamOf } from './helpers';

installLocalStorage();
beforeEach(() => localStorage.clear());

const respond = (body: string, status = 200) => new Response(streamOf(...chopped(body, 11)), { status });

describe('headers', () => {
  it('uses each provider’s own way of carrying the key', () => {
    expect(headersFor(OPENAI, 'k1', 'POST', true)).toEqual({ accept: 'text/event-stream', 'content-type': 'application/json', authorization: 'Bearer k1' });
    expect(headersFor(ANTHROPIC, 'k2', 'POST', false)).toEqual({ accept: 'text/event-stream', 'content-type': 'application/json', 'x-api-key': 'k2', 'anthropic-version': '2023-06-01' });
    expect(headersFor(ANTHROPIC, 'k2', 'GET', true)).toMatchObject({ accept: 'application/json', 'anthropic-dangerous-direct-browser-access': 'true' });
    expect(headersFor(OPENAI, null, 'GET', true)).toEqual({ accept: 'application/json' });
  });
});

describe('talking to a provider straight from a browser', () => {
  it('sends the saved key to the provider’s address, and nothing else along', async () => {
    browserKeys.set('openai', 'sk-test-key');
    const fetchFn = vi.fn(async () => respond('ok'));
    const response = await browserTransport(fetchFn as unknown as typeof fetch).send(OPENAI, { method: 'POST', path: '/chat/completions', body: { a: 1 } });
    expect(response.ok).toBe(true);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', body: '{"a":1}' });
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-test-key');
  });

  it('refuses without a key, except for a custom server, which may not need one', async () => {
    const fetchFn = vi.fn(async () => respond('ok'));
    const transport = browserTransport(fetchFn as unknown as typeof fetch);
    await expect(transport.send(OPENAI, { method: 'GET', path: '/models' })).rejects.toMatchObject({ code: 'provider_no_key' });
    expect(fetchFn).not.toHaveBeenCalled();
    await transport.send(CUSTOM, { method: 'GET', path: '/models' });
    expect((fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].headers).not.toHaveProperty('authorization');
  });

  it('says it can’t reach the provider when the network fails, and passes an abort through', async () => {
    browserKeys.set('openai', 'k');
    const failing = browserTransport((async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch);
    await expect(failing.send(OPENAI, { method: 'GET', path: '/models' })).rejects.toMatchObject({ code: 'provider_unreachable', message: expect.stringMatching(/OpenAI.*desktop app/s) });
    vi.stubGlobal('navigator', { onLine: false });
    await expect(failing.send(OPENAI, { method: 'GET', path: '/models' })).rejects.toMatchObject({ code: 'offline' });
    vi.unstubAllGlobals();
    await expect(browserTransport((async () => { throw new DOMException('x', 'AbortError'); }) as unknown as typeof fetch).send(OPENAI, { method: 'GET', path: '/models' })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('explains an unreachable server of the user’s own as that, not as being offline', async () => {
    const failing = browserTransport((async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch);
    await expect(failing.send(CUSTOM, { method: 'GET', path: '/models' })).rejects.toMatchObject({ code: 'provider_unreachable', message: expect.stringMatching(/CORS.*desktop app/s) });
  });

  it('keeps keys and custom servers in this browser, and ignores damaged entries', () => {
    browserKeys.set('a', '1');
    browserKeys.set('b', '2');
    browserKeys.clear('a');
    expect([browserKeys.get('a'), browserKeys.get('b')]).toEqual([null, '2']);
    browserEndpoints.save({ id: 'custom-abc123', name: 'Ollama', baseUrl: 'http://localhost:11434/v1', protocol: 'openai' });
    localStorage.setItem('quo.providerEndpoints', JSON.stringify([...browserEndpoints.list(), { id: 'custom-bad', name: 'x', baseUrl: 'ftp://nope', protocol: 'openai' }, 7]));
    expect(browserEndpoints.list().map(e => e.id)).toEqual(['custom-abc123']);
    browserEndpoints.remove('custom-abc123');
    expect(browserEndpoints.list()).toEqual([]);
  });
});

/** A fake of the desktop app's provider bridge: the test pushes events as the main process would. */
function fakeBridge() {
  let listener: (event: ProviderEvent) => void = () => {};
  const requests: { id: string; providerId: string; path: string; body?: unknown }[] = [];
  const bridge: DesktopProviders = {
    list: vi.fn(), setKey: vi.fn(), clearKey: vi.fn(), saveCustom: vi.fn(), removeCustom: vi.fn(),
    request: vi.fn(async request => { requests.push(request); return { ok: true }; }),
    abort: vi.fn(async () => ({ ok: true })),
    onEvent: callback => { listener = callback; return () => {}; },
  };
  return { bridge, requests, push: (event: ProviderEvent) => listener(event) };
}

describe('talking to a provider through the desktop app', () => {
  it('streams the answer as the main process sends it', async () => {
    const { bridge, requests, push } = fakeBridge();
    const pending = desktopTransport(bridge).send(OPENAI, { method: 'POST', path: '/chat/completions', body: { x: 1 } });
    await Promise.resolve();
    const [{ id }] = requests;
    expect(requests[0]).toMatchObject({ providerId: 'openai', path: '/chat/completions', body: { x: 1 } });
    push({ id, type: 'head', status: 200 });
    const response = await pending;
    expect(response.ok).toBe(true);
    push({ id, type: 'chunk', data: new TextEncoder().encode('hel') });
    push({ id, type: 'chunk', data: new TextEncoder().encode('lo') });
    push({ id, type: 'end' });
    expect(await new Response(response.body).text()).toBe('hello');
  });

  it('ignores events for requests it doesn’t know', () => {
    const { bridge, push } = fakeBridge();
    desktopTransport(bridge).send(OPENAI, { method: 'GET', path: '/models' }).catch(() => {});
    expect(() => push({ id: 'other', type: 'chunk', data: new Uint8Array([1]) })).not.toThrow();
  });

  it('says so when no key is saved, and when the provider can’t be reached', async () => {
    const first = fakeBridge();
    first.bridge.request = vi.fn(async () => ({ error: { code: 'no_key', message: 'No key.' } }));
    await expect(desktopTransport(first.bridge).send(OPENAI, { method: 'GET', path: '/models' })).rejects.toMatchObject({ code: 'provider_no_key' });
    const second = fakeBridge();
    const pending = desktopTransport(second.bridge).send(OPENAI, { method: 'GET', path: '/models' });
    await Promise.resolve();
    second.push({ id: second.requests[0].id, type: 'error', message: 'ENOTFOUND' });
    await expect(pending).rejects.toMatchObject({ code: 'offline' });
    const own = fakeBridge();
    const ownPending = desktopTransport(own.bridge).send(CUSTOM, { method: 'GET', path: '/models' });
    await Promise.resolve();
    own.push({ id: own.requests[0].id, type: 'error', message: 'ECONNREFUSED' });
    await expect(ownPending).rejects.toMatchObject({ code: 'provider_unreachable', message: expect.not.stringContaining('CORS') });
    const third = fakeBridge();
    third.bridge.request = vi.fn(async () => { throw new NativeError('failed', 'boom'); });
    await expect(desktopTransport(third.bridge).send(OPENAI, { method: 'GET', path: '/models' })).rejects.toBeInstanceOf(NativeError);
  });

  it('breaks the stream, not the request, when the connection drops after the answer began', async () => {
    const { bridge, requests, push } = fakeBridge();
    const pending = desktopTransport(bridge).send(OPENAI, { method: 'POST', path: '/chat/completions', body: {} });
    await Promise.resolve();
    const { id } = requests[0];
    push({ id, type: 'head', status: 200 });
    const response = await pending;
    push({ id, type: 'chunk', data: new TextEncoder().encode('partial') });
    push({ id, type: 'error', message: 'socket hang up' });
    await expect(new Response(response.body).text()).rejects.toThrow('socket hang up');
  });

  it('tells the main process to stop when asked to, before or during the answer', async () => {
    const { bridge, requests, push } = fakeBridge();
    const transport = desktopTransport(bridge);
    const early = new AbortController();
    const pending = transport.send(OPENAI, { method: 'GET', path: '/models', signal: early.signal });
    await Promise.resolve();
    early.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(bridge.abort).toHaveBeenCalledWith(requests[0].id);

    const late = new AbortController();
    const second = transport.send(OPENAI, { method: 'POST', path: '/chat/completions', body: {}, signal: late.signal });
    await Promise.resolve();
    push({ id: requests[1].id, type: 'head', status: 200 });
    const response = await second;
    late.abort();
    await expect(new Response(response.body).text()).rejects.toMatchObject({ name: 'AbortError' });
    expect(bridge.abort).toHaveBeenCalledWith(requests[1].id);
    await expect(transport.send(OPENAI, { method: 'GET', path: '/models', signal: AbortSignal.abort() })).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('a whole request to a provider', () => {
  const transport = (response: Response) => ({ send: vi.fn(async () => ({ status: response.status, ok: response.ok, body: response.body! })) });

  it('streams updates and returns the finished reply', async () => {
    const updates: string[] = [];
    const t = transport(respond(sse({ choices: [{ delta: { content: 'Hi' } }] }, { choices: [{ delta: { content: '!' }, finish_reason: 'stop' }] }, '[DONE]')));
    const reply = await chatWithProvider(OPENAI, { model: 'm', maxTokens: 10, messages: [{ role: 'user', content: 'yo' }] }, partial => updates.push(partial.content), t);
    expect(reply.content).toBe('Hi!');
    expect(updates.at(-1)).toBe('Hi!');
    expect(t.send.mock.calls[0]).toMatchObject([OPENAI, { method: 'POST', path: '/chat/completions' }]);
  });

  it('throws what the provider said, in words, when it refuses', async () => {
    const t = transport(respond(JSON.stringify({ error: { message: 'Invalid API key' } }), 401));
    await expect(chatWithProvider(OPENAI, { model: 'm', maxTokens: 10, messages: [] }, undefined, t)).rejects.toMatchObject({ code: 'provider_auth', provider: 'openai', message: expect.stringContaining('Invalid API key') });
  });

  it('names the provider in a mid-stream error', async () => {
    const openai = transport(respond(sse({ error: { message: 'busy' } })));
    await expect(chatWithProvider(OPENAI, { model: 'm', maxTokens: 10, messages: [] }, undefined, openai)).rejects.toMatchObject({ provider: 'openai' });
    const claude = transport(respond(sse(['error', { type: 'error', error: { type: 'overloaded_error', message: 'busy' } }])));
    await expect(chatWithProvider(ANTHROPIC, { model: 'm', maxTokens: 10, messages: [] }, undefined, claude)).rejects.toMatchObject({ provider: 'anthropic', message: expect.stringContaining('busy') });
  });
});

describe('a provider’s model list', () => {
  const list = (body: unknown, status = 200) => ({ send: vi.fn(async () => ({ status, ok: status < 300, body: respond(JSON.stringify(body), status).body! })) });

  it('keeps chat models, tidies the names, and notes which can use tools', async () => {
    const models = await listProviderModels(OPENAI, list({ data: [
      { id: 'gpt-x' }, { id: 'text-embedding-9' }, { id: 'whisper-1' }, { id: 'gpt-x' }, { id: 'models/gemini-pro', name: 'models/gemini-pro' }, { id: 'a/b', name: 'Vendor: B', context_length: 128000, supported_parameters: ['tools', 'x'] }, { id: 'c/d', name: 'D', supported_parameters: ['x'] }, { name: 'no id' },
    ] }));
    expect(models).toEqual([
      { id: 'c/d', name: 'D', tools: false },
      { id: 'gemini-pro', name: 'gemini-pro' },
      { id: 'gpt-x', name: 'gpt-x' },
      { id: 'a/b', name: 'Vendor: B', contextTokens: 128000, tools: true },
    ].sort((a, b) => a.name.localeCompare(b.name)));
  });

  it('asks Anthropic for the whole list, and uses its display names', async () => {
    const t = list({ data: [{ id: 'claude-x', display_name: 'Claude X' }] });
    expect(await listProviderModels(ANTHROPIC, t)).toEqual([{ id: 'claude-x', name: 'Claude X' }]);
    expect(t.send.mock.calls[0]).toMatchObject([ANTHROPIC, { method: 'GET', path: '/models?limit=1000' }]);
  });

  it('explains a refused key, and gives nothing for a list it can’t read', async () => {
    await expect(listProviderModels(OPENAI, list({ error: { message: 'bad key' } }, 401))).rejects.toMatchObject({ code: 'provider_auth' });
    expect(await listProviderModels(OPENAI, { send: async () => ({ status: 200, ok: true, body: streamOf('<html>') }) })).toEqual([]);
  });
});
