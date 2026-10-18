import { api } from './api';

export interface CloudModel {
  id: string;
  name: string;
  provider: string;
  description: string;
  /** The default model: free within the daily allowance. */
  free: boolean;
  supportsThinking: boolean;
  /** Credits for a typical message. */
  creditsPerMessage: number;
}

export interface CloudCatalog {
  defaultModel: string;
  models: CloudModel[];
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
