import { useSyncExternalStore } from 'react';

/**
 * What Quo does when the model you picked can't be used because of the connection: no internet, or a cloud model
 * that is out of messages, credits or has a key that was refused.
 *  - 'switch': move to your offline model by itself (with an Undo), and run the message there.
 *  - 'ask': offer the switch and wait.
 *  - 'off': leave it alone; the chat explains what happened.
 * It only ever moves *toward* your offline model. A cloud model is never chosen for you.
 */

export type Fallback = 'switch' | 'ask' | 'off';
export const FALLBACKS: Fallback[] = ['switch', 'ask', 'off'];

const KEY = 'quo.fallback';

function read(): Fallback {
  try {
    const value = localStorage.getItem(KEY);
    return FALLBACKS.includes(value as Fallback) ? (value as Fallback) : 'switch';
  } catch {
    return 'switch';
  }
}

let current: Fallback | null = null;
const listeners = new Set<() => void>();

export const fallbackSetting = (): Fallback => (current ??= read());

export function setFallbackSetting(value: Fallback): void {
  current = value;
  try {
    localStorage.setItem(KEY, value);
  } catch {
    // Private mode: it just won't survive a reload.
  }
  listeners.forEach(listener => listener());
}

export function useFallbackSetting(): Fallback {
  return useSyncExternalStore(listener => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, fallbackSetting);
}
