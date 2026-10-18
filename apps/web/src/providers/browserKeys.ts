import { cleanBaseUrl, CUSTOM_ID, type Protocol } from './registry';

/**
 * Keys and custom servers when Quo runs in a browser. They live in this browser's own storage and nowhere
 * else: never sent to Quo, never synced. (The desktop app keeps them in the operating system's secure
 * storage instead, out of reach of the page.)
 */

const KEYS = 'quo.providerKeys';
const ENDPOINTS = 'quo.providerEndpoints';

export interface CustomEndpoint {
  id: string;
  name: string;
  baseUrl: string;
  protocol: Protocol;
}

function read<T>(name: string, fallback: T): T {
  try {
    const value = JSON.parse(localStorage.getItem(name) ?? 'null');
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function write(name: string, value: unknown): void {
  try {
    localStorage.setItem(name, JSON.stringify(value));
  } catch {
    throw new Error('This browser won’t store keys (private browsing?).');
  }
}

export const browserKeys = {
  get: (id: string): string | null => read<Record<string, string>>(KEYS, {})[id] ?? null,
  set(id: string, key: string): void {
    write(KEYS, { ...read<Record<string, string>>(KEYS, {}), [id]: key });
  },
  clear(id: string): void {
    const { [id]: _removed, ...rest } = read<Record<string, string>>(KEYS, {});
    write(KEYS, rest);
  },
};

export const browserEndpoints = {
  list: (): CustomEndpoint[] => read<unknown[]>(ENDPOINTS, []).filter((entry): entry is CustomEndpoint => {
    const e = entry as Partial<CustomEndpoint>;
    return typeof e?.id === 'string' && CUSTOM_ID.test(e.id) && typeof e.name === 'string' && typeof e.baseUrl === 'string' && (e.protocol === 'openai' || e.protocol === 'anthropic') && cleanBaseUrl(e.baseUrl) !== null;
  }),
  save(entry: CustomEndpoint): void {
    write(ENDPOINTS, [...browserEndpoints.list().filter(e => e.id !== entry.id), entry]);
  },
  remove(id: string): void {
    write(ENDPOINTS, browserEndpoints.list().filter(e => e.id !== id));
  },
};
