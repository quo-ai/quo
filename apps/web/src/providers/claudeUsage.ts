import { useSyncExternalStore } from 'react';
import type { PlanUsage } from './wire';

/**
 * The person's Claude plan usage, as the last Claude Agent reply reported it, kept on this device. Claude Code reports
 * it with every reply (no extra request), so it is as fresh as the last message; `at` says when that was.
 */

export interface SavedUsage extends PlanUsage {
  at: number;
}

const KEY = 'quo.claudeUsage';

function read(): SavedUsage | null {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as SavedUsage | null;
    return saved && Array.isArray(saved.windows) && typeof saved.at === 'number' ? saved : null;
  } catch {
    return null;
  }
}

let saved: SavedUsage | null | undefined;
const listeners = new Set<() => void>();
const current = (): SavedUsage | null => (saved === undefined ? (saved = read()) : saved);

export function noteUsage(plan: PlanUsage | undefined): void {
  if (!plan) return;
  saved = { ...plan, at: Date.now() };
  try {
    localStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    // Private mode: it just won't survive a reload.
  }
  listeners.forEach(listener => listener());
}

export function useClaudeUsage(): SavedUsage | null {
  return useSyncExternalStore(listener => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, current);
}

const NAMES: Record<string, [string, string]> = {
  five_hour: ['5-hour limit', '5h'],
  seven_day: ['Weekly limit', 'Week'],
  seven_day_opus: ['Weekly Opus limit', 'Opus'],
  seven_day_sonnet: ['Weekly Sonnet limit', 'Sonnet'],
};

/** A window's name in full and short: "5-hour limit" and "5h". */
export const windowName = (id: string): [string, string] => NAMES[id] ?? [id.replace(/_/g, ' '), id.replace(/_/g, ' ')];

/** The window closest to its limit, which is the one that matters next. A window that has reset since is left out. */
export function tightest(usage: SavedUsage, now = Date.now()): SavedUsage['windows'][number] | null {
  const live = usage.windows.filter(window => window.resetsAt === null || window.resetsAt > now);
  return live.reduce<SavedUsage['windows'][number] | null>((top, window) => (!top || window.used > top.used ? window : top), null);
}
