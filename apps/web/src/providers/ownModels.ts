import { useSyncExternalStore } from 'react';
import type { ProviderInfo } from './registry';

/**
 * The models a person chose to use with their own keys. They are picked from what each provider offers (or
 * typed in by name) and listed in the model menu like any other. Kept on this device only.
 */

export interface OwnModel {
  /** `<provider>:<the provider's name for the model>`. */
  id: string;
  provider: string;
  /** What the provider calls it, sent with each request. */
  apiModel: string;
  name: string;
  /** May be used in Code mode. Needs a model that can call tools. */
  agent: boolean;
  /** How much the model can read at once, when the provider says. */
  contextTokens?: number;
}

const KEY = 'quo.ownModels';

export const ownModelId = (provider: string, apiModel: string): string => `${provider}:${apiModel}`;

function read(): OwnModel[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return (Array.isArray(list) ? list : []).filter((m): m is OwnModel => {
      const model = m as Partial<OwnModel>;
      return typeof model?.id === 'string' && typeof model.provider === 'string' && typeof model.apiModel === 'string' && typeof model.name === 'string' && model.id === ownModelId(model.provider, model.apiModel);
    }).map(m => ({ id: m.id, provider: m.provider, apiModel: m.apiModel, name: m.name, agent: Boolean(m.agent), ...(typeof m.contextTokens === 'number' ? { contextTokens: m.contextTokens } : {}) }));
  } catch {
    return [];
  }
}

let models: OwnModel[] | null = null;
const listeners = new Set<() => void>();

function save(next: OwnModel[]): void {
  models = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Private mode: it just won't survive a reload.
  }
  listeners.forEach(listener => listener());
}

export const ownModels = (): OwnModel[] => (models ??= read());
export const getOwnModel = (id: string): OwnModel | undefined => ownModels().find(model => model.id === id);

export function useOwnModels(): OwnModel[] {
  return useSyncExternalStore(listener => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, ownModels);
}

/** Adds a model, or updates it if it's already there. */
export function addOwnModel(provider: ProviderInfo, apiModel: string, details: { name?: string; agent?: boolean; contextTokens?: number } = {}): OwnModel {
  const id = ownModelId(provider.id, apiModel);
  const before = getOwnModel(id);
  const model: OwnModel = {
    id,
    provider: provider.id,
    apiModel,
    name: details.name?.trim() || before?.name || apiModel,
    agent: details.agent ?? before?.agent ?? !provider.custom,
    ...((details.contextTokens ?? before?.contextTokens) ? { contextTokens: details.contextTokens ?? before?.contextTokens } : {}),
  };
  save([...ownModels().filter(m => m.id !== id), model]);
  return model;
}

export const removeOwnModel = (id: string): void => save(ownModels().filter(model => model.id !== id));
export const setOwnModelAgent = (id: string, agent: boolean): void => save(ownModels().map(model => (model.id === id ? { ...model, agent } : model)));
export const removeProviderModels = (provider: string): void => save(ownModels().filter(model => model.provider !== provider));
