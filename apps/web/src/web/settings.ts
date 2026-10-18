import { useSyncExternalStore } from 'react';

/**
 * Whether web search is on at the start of a chat. With cloud models and the user's own keys it is on: the
 * question already goes to a provider. With offline models it is off, which keeps an offline chat offline (and keeps
 * photos, documents, memories and thinking, which a chat with web tools can't use); one switch turns it on.
 */

export interface WebSettings {
  online: boolean;
  offline: boolean;
}

const KEY = 'quo.web';
const DEFAULTS: WebSettings = { online: true, offline: false };

function read(): WebSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<WebSettings>;
    return { online: typeof saved.online === 'boolean' ? saved.online : DEFAULTS.online, offline: typeof saved.offline === 'boolean' ? saved.offline : DEFAULTS.offline };
  } catch {
    return DEFAULTS;
  }
}

let current: WebSettings | null = null;
const listeners = new Set<() => void>();

export const webSettings = (): WebSettings => (current ??= read());

export function setWebSettings(patch: Partial<WebSettings>): void {
  current = { ...webSettings(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Private mode: it just won't survive a reload.
  }
  listeners.forEach(listener => listener());
}

export function useWebSettings(): WebSettings {
  return useSyncExternalStore(listener => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, webSettings);
}
