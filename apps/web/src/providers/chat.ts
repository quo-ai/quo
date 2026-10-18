import { anthropic } from './anthropic';
import { errorFor, ProviderError } from './errors';
import { openai } from './openai';
import type { ProviderInfo } from './registry';
import { defaultTransport, type Transport } from './transport';
import type { Adapter, ChatReply, ChatRequest, Streamed } from './wire';

export const adapterFor = (provider: ProviderInfo): Adapter => (provider.protocol === 'anthropic' ? anthropic : openai);

/** Reads the start of a failed response, which is where providers explain themselves. */
async function readText(stream: ReadableStream<Uint8Array>, max = 8000): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = '';
  try {
    while (text.length < max) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return text;
}

/**
 * One request to a provider with the user's own key: send the conversation, stream the answer back through
 * `onUpdate`, return it finished. Failures come back as a ProviderError that says what to do.
 */
export async function chatWithProvider(
  provider: ProviderInfo,
  request: ChatRequest,
  onUpdate: (partial: Streamed) => void = () => {},
  transport: Transport = defaultTransport(),
): Promise<ChatReply> {
  const adapter = adapterFor(provider);
  const response = await transport.send(provider, { method: 'POST', path: adapter.path, body: adapter.body(request, provider.usage), signal: request.signal });
  if (!response.ok) throw errorFor(provider, response.status, await readText(response.body));
  try {
    return await adapter.read(response.body, onUpdate);
  } catch (error) {
    if (error instanceof ProviderError && !error.provider) throw new ProviderError(error.status, error.code, error.message, provider.id);
    throw error;
  }
}
