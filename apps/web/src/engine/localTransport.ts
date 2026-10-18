import { ProviderError } from '../providers/errors';
import type { ProviderInfo } from '../providers/registry';
import type { Transport } from '../providers/transport';

/**
 * The offline model, spoken to like any OpenAI-style server: the desktop app's native engine (llama.cpp) is one,
 * reached through the app's own address /engine, which the main process forwards to it. Nothing leaves the computer.
 */
export const LOCAL_PROVIDER: ProviderInfo = { id: 'local', name: 'The offline model', protocol: 'openai', baseUrl: '/engine/v1', usage: false, custom: true };

export const localTransport: Transport = {
  async send(provider, { method, path, body, signal }) {
    let response: Response;
    try {
      response = await fetch(`${provider.baseUrl}${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if ((error as DOMException)?.name === 'AbortError') throw error;
      throw new ProviderError(0, 'provider_unreachable', 'The offline model isn’t answering. It restarts with your next message.', provider.id);
    }
    return { status: response.status, ok: response.ok, body: response.body ?? new ReadableStream({ start: controller => controller.close() }) };
  },
};
