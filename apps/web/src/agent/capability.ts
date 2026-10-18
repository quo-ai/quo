import { useSyncExternalStore } from 'react';
import type { LocalModel } from '../catalog';

/**
 * Which offline models Code mode is turned on for. A model is expected to be 'good' (9B and up, recommended and on by
 * default), 'limited' (small jobs), 'weak' (too small to be reliable) or 'unknown' (one the user added themselves).
 * Weak, limited and unknown models are off until the person turns them on, with the reason in front of them. This is
 * about quality only: every change and command still needs their OK, whatever the model.
 */

export type AgentRating = 'good' | 'limited' | 'weak' | 'unknown';

export const agentRating = (model: LocalModel): AgentRating => model.agent ?? (model.custom ? 'unknown' : 'weak');

const NOTES: Record<AgentRating, string> = {
  good: 'Recommended for Code mode.',
  limited: 'Handles small jobs. Bigger ones often go wrong.',
  weak: 'Too small to work on code reliably: it may misread files or make wrong edits.',
  unknown: 'Quo can’t tell how well this model handles code. Models of about 9 billion parameters or more, trained to call tools, work best.',
};

export const ratingNote = (model: LocalModel): string => NOTES[agentRating(model)];

const KEY = 'quo.codeOffline';
interface Choices {
  on: string[];
  off: string[];
}

function read(): Choices {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Choices>;
    const ids = (list: unknown) => (Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string') : []);
    return { on: ids(saved.on), off: ids(saved.off) };
  } catch {
    return { on: [], off: [] };
  }
}

let choices: Choices | null = null;
const listeners = new Set<() => void>();
const current = (): Choices => (choices ??= read());

/** Whether Code mode may be used with this offline model: what the person chose, else whether it is recommended. */
export function isLocalCodeAllowed(model: LocalModel): boolean {
  const { on, off } = current();
  if (on.includes(model.id)) return true;
  if (off.includes(model.id)) return false;
  return agentRating(model) === 'good';
}

export function setLocalCodeAllowed(model: LocalModel, allowed: boolean): void {
  const { on, off } = current();
  choices = { on: [...on.filter(id => id !== model.id), ...(allowed ? [model.id] : [])], off: [...off.filter(id => id !== model.id), ...(allowed ? [] : [model.id])] };
  try {
    localStorage.setItem(KEY, JSON.stringify(choices));
  } catch {
    // Private mode: it just won't survive a reload.
  }
  listeners.forEach(listener => listener());
}

/** Re-renders when a choice changes. */
export function useLocalCodeChoices(): Choices {
  return useSyncExternalStore(listener => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, current);
}
