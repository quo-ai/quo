import { useSyncExternalStore } from 'react';

/** Whether Quo summarises a conversation by itself when the model's memory is nearly full (on by default). */

const KEY = 'quo.autoSummarize';
let current: boolean | null = null;
const listeners = new Set<() => void>();

export const autoSummarize = (): boolean => (current ??= (() => {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
})());

export function setAutoSummarize(on: boolean): void {
  current = on;
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    // Private mode: it just won't survive a reload.
  }
  listeners.forEach(listener => listener());
}

export function useAutoSummarize(): boolean {
  return useSyncExternalStore(listener => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, autoSummarize);
}

/** From this share of the window, a conversation is summarised before the next message (if that is on). */
export const SUMMARIZE_AT = 0.85;
/** Fewer messages than this are too short to be worth summarising. */
export const MIN_MESSAGES = 4;
