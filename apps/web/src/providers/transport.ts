import { NativeError, providersBridge, unwrap, type DesktopProviders } from '../native';
import { browserKeys } from './browserKeys';
import { ProviderError } from './errors';
import { headersFor } from './headers';
import type { ProviderInfo } from './registry';

/**
 * How a request reaches a provider. In the desktop app it goes through the main process, which adds the
 * user's key itself, so the page never holds it. In a browser it goes straight to the provider with the key
 * kept in that browser. Either way it never touches Quo's servers.
 */

export interface ProviderRequest {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  signal?: AbortSignal;
}

export interface ProviderResponse {
  status: number;
  ok: boolean;
  body: ReadableStream<Uint8Array>;
}

export interface Transport {
  send(provider: ProviderInfo, request: ProviderRequest): Promise<ProviderResponse>;
}

const aborted = () => new DOMException('Aborted', 'AbortError');
/**
 * A provider that can't be reached. Only when the browser says it is offline is that "you're offline": otherwise, for
 * a server of the user's own it is usually that it isn't running, or (in a browser) that it doesn't allow this site
 * or the browser hasn't let the page reach their own network, and some providers don't accept requests from web pages.
 */
const unreachable = (provider: ProviderInfo, inBrowser: boolean) => {
  const offline = inBrowser ? typeof navigator !== 'undefined' && navigator.onLine === false : !provider.custom;
  if (offline) return new ProviderError(0, 'offline', `Couldn’t reach ${provider.name}. Check your connection.`, provider.id);
  const why = provider.custom
    ? `Check that it is running${inBrowser ? ', that it allows this site (CORS), and that your browser let Quo reach devices on your network. The desktop app has none of these limits' : ''}.`
    : 'Check your connection. Some providers don’t accept requests from a web page: the desktop app works with every provider.';
  return new ProviderError(0, 'provider_unreachable', `Couldn’t reach ${provider.name}. ${why}`, provider.id);
};
const noKey = (provider: ProviderInfo) => new ProviderError(401, 'provider_no_key', `Add your ${provider.name} key first (Models & storage → Your keys).`, provider.id);

export function browserTransport(fetchFn: typeof fetch = (...args) => fetch(...args)): Transport {
  return {
    async send(provider, { method, path, body, signal }) {
      const key = browserKeys.get(provider.id);
      if (!key && !provider.custom) throw noKey(provider);
      let response: Response;
      try {
        response = await fetchFn(`${provider.baseUrl}${path}`, {
          method,
          headers: headersFor(provider, key, method, true),
          body: body === undefined ? undefined : JSON.stringify(body),
          signal,
          redirect: 'error',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
        });
      } catch (error) {
        if ((error as DOMException)?.name === 'AbortError') throw error;
        throw unreachable(provider, true);
      }
      return { status: response.status, ok: response.ok, body: response.body ?? new ReadableStream({ start: controller => controller.close() }) };
    },
  };
}

interface Pending {
  head: (status: number) => void;
  fail: (error: unknown) => void;
  controller: ReadableStreamDefaultController<Uint8Array>;
  gotHead: boolean;
}

export function desktopTransport(bridge: DesktopProviders): Transport {
  const pending = new Map<string, Pending>();
  let listening = false;
  const listen = () => {
    if (listening) return;
    listening = true;
    bridge.onEvent(event => {
      const entry = pending.get(event.id);
      if (!entry) return;
      if (event.type === 'head') {
        entry.gotHead = true;
        entry.head(event.status);
      } else if (event.type === 'chunk') entry.controller.enqueue(new Uint8Array(event.data));
      else {
        pending.delete(event.id);
        if (event.type === 'end') entry.controller.close();
        else if (entry.gotHead) entry.controller.error(new Error(event.message));
        else entry.fail(new Error(event.message));
      }
    });
  };

  return {
    send(provider, { method, path, body, signal }) {
      listen();
      const id = crypto.randomUUID();
      return new Promise<ProviderResponse>((resolve, reject) => {
        if (signal?.aborted) return reject(aborted());
        let controller!: ReadableStreamDefaultController<Uint8Array>;
        const stream = new ReadableStream<Uint8Array>({
          start: c => {
            controller = c;
          },
          cancel: () => {
            pending.delete(id);
            void bridge.abort(id);
          },
        });
        const finish = (error: unknown) => {
          pending.delete(id);
          signal?.removeEventListener('abort', onAbort);
          reject(error);
        };
        const onAbort = () => {
          void bridge.abort(id);
          const entry = pending.get(id);
          pending.delete(id);
          if (entry?.gotHead) entry.controller.error(aborted());
          else reject(aborted());
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        pending.set(id, {
          controller,
          gotHead: false,
          head: status => resolve({ status, ok: status >= 200 && status < 300, body: stream }),
          fail: () => finish(unreachable(provider, false)),
        });
        bridge.request({ id, providerId: provider.id, method, path, body }).then(
          result => {
            try {
              unwrap(result);
            } catch (error) {
              finish(error instanceof NativeError && error.code === 'no_key' ? noKey(provider) : error instanceof NativeError ? new ProviderError(400, 'provider_failed', error.message, provider.id) : error);
            }
          },
          error => finish(error),
        );
      });
    },
  };
}

let current: Transport | null = null;

/** The transport for this build: through the desktop app's main process when there is one, otherwise direct. */
export function defaultTransport(): Transport {
  const bridge = providersBridge();
  return (current ??= bridge ? desktopTransport(bridge) : browserTransport());
}
