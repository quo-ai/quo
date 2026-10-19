import { useSyncExternalStore } from 'react';

/**
 * How Code mode behaves, set in Models & storage → Code. None of these loosen what needs your OK: they only
 * make it stricter, or choose how Quo starts and how long a reply may run.
 */

export interface CodeSettings {
  /** Run read-only commands (git status, git diff…) without asking. Off: every command asks. */
  autoReadOnly: boolean;
  /** Start working in the project folder when a message is about the project (the folder used last, or ask for one), without turning Code mode on by hand. Off: use the folder button. */
  autoStart: boolean;
  /** Add Quo as co-author on commits it makes (a Co-Authored-By line at the end of the message). On by default; shown in every commit's approval window. */
  creditQuo: boolean;
  /** Follow the project's AGENTS.md or CLAUDE.md. */
  useNotes: boolean;
  /** Start every Code session in plan mode (read-only). */
  startInPlan: boolean;
  /** The most steps a single reply may take. */
  maxSteps: number;
}

export const DEFAULT_CODE_SETTINGS: CodeSettings = { autoReadOnly: true, autoStart: true, creditQuo: true, useNotes: true, startInPlan: false, maxSteps: 40 };
export const STEP_CHOICES = [10, 20, 40, 80, 150] as const;

const KEY = 'quo.codeSettings';

function read(): CodeSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<CodeSettings>;
    return {
      autoReadOnly: typeof saved.autoReadOnly === 'boolean' ? saved.autoReadOnly : DEFAULT_CODE_SETTINGS.autoReadOnly,
      autoStart: typeof saved.autoStart === 'boolean' ? saved.autoStart : DEFAULT_CODE_SETTINGS.autoStart,
      creditQuo: typeof saved.creditQuo === 'boolean' ? saved.creditQuo : DEFAULT_CODE_SETTINGS.creditQuo,
      useNotes: typeof saved.useNotes === 'boolean' ? saved.useNotes : DEFAULT_CODE_SETTINGS.useNotes,
      startInPlan: typeof saved.startInPlan === 'boolean' ? saved.startInPlan : DEFAULT_CODE_SETTINGS.startInPlan,
      maxSteps: STEP_CHOICES.includes(saved.maxSteps as (typeof STEP_CHOICES)[number]) ? (saved.maxSteps as number) : DEFAULT_CODE_SETTINGS.maxSteps,
    };
  } catch {
    return DEFAULT_CODE_SETTINGS;
  }
}

let current: CodeSettings | null = null;
const listeners = new Set<() => void>();

export const codeSettings = (): CodeSettings => (current ??= read());

export function setCodeSettings(patch: Partial<CodeSettings>): void {
  current = { ...codeSettings(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Private mode: it just won't survive a reload.
  }
  listeners.forEach(listener => listener());
}

export function useCodeSettings(): CodeSettings {
  return useSyncExternalStore(listener => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, codeSettings);
}
