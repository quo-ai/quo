import type { ProviderInfo } from '../registry';

/** A response body that arrives in the given pieces. */
export function streamOf(...pieces: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const piece of pieces) controller.enqueue(encoder.encode(piece));
      controller.close();
    },
  });
}

/** The same text cut into pieces of `size` characters, so events are split in the middle. */
export const chopped = (text: string, size = 7): string[] => text.match(new RegExp(`[\\s\\S]{1,${size}}`, 'g')) ?? [];

export const sse = (...events: (string | object | [string, object])[]): string =>
  events.map(event => (typeof event === 'string' ? `data: ${event}\n\n` : Array.isArray(event) ? `event: ${event[0]}\ndata: ${JSON.stringify(event[1])}\n\n` : `data: ${JSON.stringify(event)}\n\n`)).join('');

export const OPENAI: ProviderInfo = { id: 'openai', name: 'OpenAI', protocol: 'openai', baseUrl: 'https://api.openai.com/v1', usage: true };
export const ANTHROPIC: ProviderInfo = { id: 'anthropic', name: 'Anthropic', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', usage: true };
export const CUSTOM: ProviderInfo = { id: 'custom-abc123', name: 'My server', protocol: 'openai', baseUrl: 'http://localhost:11434/v1', usage: false, custom: true };

/** A stand-in for the browser's localStorage, which the test environment (Node) doesn't have. */
export function installLocalStorage(): void {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, String(value)),
      removeItem: (key: string) => void data.delete(key),
      clear: () => data.clear(),
    },
  });
}
