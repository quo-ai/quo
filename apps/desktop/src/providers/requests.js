'use strict';

const { BUILT_IN, allowed } = require('./registry');
const { ProviderError } = require('./errors');

/**
 * Requests to a provider on the page's behalf. The page says which provider and which call (the chat call
 * or the model list; nothing else is allowed) and gives the body; this adds the user's key, sends it, and
 * passes the answer back piece by piece. The page never sees the key and can't choose the address, the
 * headers or follow a redirect: a redirect would carry the key to another host, so it ends the request.
 */

const LIMITS = {
  maxBodyBytes: 16 * 1024 * 1024,
  maxResponseBytes: 64 * 1024 * 1024,
  maxActive: 6,
  // How long a provider may say nothing (reasoning models can think for minutes, and send keep-alives).
  idleMs: 180_000,
};
const REDIRECT_MESSAGE = 'The provider redirected the request. Quo doesn’t follow redirects, because they could carry your key somewhere else.';
const ID_SHAPE = /^[A-Za-z0-9-]{8,64}$/;

/** The headers a provider wants, with the key. */
function headersFor(protocol, key, method) {
  const headers = { accept: method === 'POST' ? 'text/event-stream' : 'application/json', 'user-agent': 'Quo' };
  if (method === 'POST') headers['content-type'] = 'application/json';
  if (protocol === 'anthropic') {
    if (key) headers['x-api-key'] = key;
    headers['anthropic-version'] = '2023-06-01';
  } else if (key) headers.authorization = `Bearer ${key}`;
  return headers;
}

class ProviderRequests {
  constructor({ keys, endpoints, fetchFn = globalThis.fetch, limits = {} }) {
    this.keys = keys;
    this.endpoints = endpoints;
    this.fetch = fetchFn;
    this.limits = { ...LIMITS, ...limits };
    this.active = new Map();
    this.stopped = new Set();
  }

  async resolve(providerId) {
    const builtIn = BUILT_IN[providerId];
    if (builtIn) return { id: providerId, ...builtIn, custom: false };
    const custom = await this.endpoints.get(providerId);
    return custom ? { ...custom, custom: true } : null;
  }

  /** Checks a request and starts it. Throws if it isn't allowed; after that, the answer comes through `emit`. */
  async start({ id, providerId, method, path, body }, emit) {
    if (typeof id !== 'string' || !ID_SHAPE.test(id) || this.active.has(id)) throw new ProviderError('bad_request', 'That request isn’t valid.');
    if (this.active.size >= this.limits.maxActive) throw new ProviderError('busy', 'Too many requests are running. Wait for one to finish.');
    const provider = await this.resolve(String(providerId));
    if (!provider) throw new ProviderError('unknown_provider', 'That provider isn’t set up.');
    if (!allowed(provider.protocol, method, path)) throw new ProviderError('bad_request', 'That request isn’t allowed.');
    let payload;
    if (method === 'POST') {
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ProviderError('bad_request', 'That request isn’t valid.');
      payload = JSON.stringify(body);
      if (payload.length > this.limits.maxBodyBytes) throw new ProviderError('too_large', 'That conversation is too large to send.');
    }
    const key = await this.keys.get(provider.id);
    if (!key && !provider.custom) throw new ProviderError('no_key', 'No key is saved for this provider.');

    const controller = new AbortController();
    this.active.set(id, controller);
    void this.run({ id, provider, method, path, payload, key, controller }, emit);
  }

  async run({ id, provider, method, path, payload, key, controller }, emit) {
    let idle;
    const touch = () => {
      clearTimeout(idle);
      idle = setTimeout(() => controller.abort(new Error('timeout')), this.limits.idleMs);
    };
    const scrub = text => (key ? String(text).split(key).join('[key removed]') : String(text));
    try {
      touch();
      const response = await this.fetch(`${provider.baseUrl}${path}`, { method, headers: headersFor(provider.protocol, key, method), body: payload, redirect: 'manual', signal: controller.signal });
      if (response.status >= 300 && response.status < 400) {
        emit({ id, type: 'error', message: REDIRECT_MESSAGE });
        return;
      }
      emit({ id, type: 'head', status: response.status });
      const reader = response.body?.getReader();
      let total = 0;
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        touch();
        total += value.byteLength;
        if (total > this.limits.maxResponseBytes) {
          controller.abort(new Error('too large'));
          emit({ id, type: 'error', message: 'The answer was too large.' });
          return;
        }
        emit({ id, type: 'chunk', data: value });
      }
      emit({ id, type: 'end' });
    } catch (error) {
      // Stopped from the page: it already knows.
      if (this.stopped.has(id)) return;
      console.warn('[providers] request failed:', scrub(error?.message), scrub(error?.cause?.message ?? ''));
      const timedOut = controller.signal.aborted && controller.signal.reason?.message === 'timeout';
      const redirected = /redirect/i.test(`${error?.message ?? ''} ${error?.cause?.message ?? ''}`);
      emit({ id, type: 'error', message: redirected ? REDIRECT_MESSAGE : timedOut ? 'The provider stopped responding.' : scrub(error?.cause?.code ? `Couldn’t connect (${error.cause.code}).` : 'Couldn’t connect.') });
    } finally {
      clearTimeout(idle);
      this.active.delete(id);
      this.stopped.delete(id);
    }
  }

  abort(id) {
    const controller = this.active.get(id);
    if (!controller) return;
    this.stopped.add(id);
    controller.abort();
  }

  abortAll() {
    for (const id of [...this.active.keys()]) this.abort(id);
  }
}

module.exports = { ProviderRequests, headersFor, LIMITS };
