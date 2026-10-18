import { api } from './api';

export interface CloudModel {
  id: string;
  name: string;
  provider: string;
  description: string;
  /** The default model: free within the daily allowance. */
  free: boolean;
  /** `frontier`: the most capable models, locked until the person has credits. `everyday`: quick and cheap. */
  tier: 'frontier' | 'everyday';
  /** Can run Code mode (desktop app): reliable tool use and strong at code. */
  agent: boolean;
  /** When the model came out (ISO date). */
  released: string;
  supportsThinking: boolean;
  /** Credits for a typical message. */
  creditsPerMessage: number;
}

export interface CloudCatalog {
  defaultModel: string;
  models: CloudModel[];
}

const NEW_FOR_DAYS = 14;

/** Out for under two weeks: the picker marks it "New". */
export function isNewModel(model: Pick<CloudModel, 'released'>, now = Date.now()): boolean {
  const age = now - Date.parse(model.released);
  // Release dates are whole days, so count whole days.
  return age >= 0 && Math.floor(age / (24 * 60 * 60 * 1000)) <= NEW_FOR_DAYS;
}

const CACHE_KEY = 'quo.cloudCatalog';

export function cachedCatalog(): CloudCatalog | null {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null');
  } catch {
    return null;
  }
}

/** Fresh from the server, falling back to the last copy (e.g. offline). */
export async function loadCatalog(): Promise<CloudCatalog | null> {
  try {
    const catalog = await api<CloudCatalog>('models');
    localStorage.setItem(CACHE_KEY, JSON.stringify(catalog));
    return catalog;
  } catch {
    return cachedCatalog();
  }
}
