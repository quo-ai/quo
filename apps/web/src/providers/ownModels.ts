import { useSyncExternalStore } from 'react';
import type { ThinkChoice } from '../../shared/thinking';
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
  /** The Thinking levels it takes, and what each means for it, when the provider says (Claude Agent). */
  thinking?: ThinkChoice[];
  thinkingHints?: Partial<Record<ThinkChoice, string>>;
  /** Where a chat with it starts (Claude Agent: Claude Code's default effort for it). */
  thinkingDefault?: ThinkChoice;
}

const KEY = 'quo.ownModels';
const LEVELS: ThinkChoice[] = ['off', 'quick', 'auto', 'deep', 'low', 'medium', 'high', 'xhigh', 'max'];
const levelsOf = (value: unknown): ThinkChoice[] | undefined => (Array.isArray(value) && value.every(level => LEVELS.includes(level)) ? (value as ThinkChoice[]) : undefined);
const hintsOf = (value: unknown): Partial<Record<ThinkChoice, string>> | undefined =>
  value && typeof value === 'object' && Object.entries(value).every(([level, hint]) => LEVELS.includes(level as ThinkChoice) && typeof hint === 'string') ? (value as Partial<Record<ThinkChoice, string>>) : undefined;

export const ownModelId = (provider: string, apiModel: string): string => `${provider}:${apiModel}`;

function read(): OwnModel[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return (Array.isArray(list) ? list : []).filter((m): m is OwnModel => {
      const model = m as Partial<OwnModel>;
      return typeof model?.id === 'string' && typeof model.provider === 'string' && typeof model.apiModel === 'string' && typeof model.name === 'string' && model.id === ownModelId(model.provider, model.apiModel);
    }).map(m => ({ id: m.id, provider: m.provider, apiModel: m.apiModel, name: m.name, agent: Boolean(m.agent), ...(typeof m.contextTokens === 'number' ? { contextTokens: m.contextTokens } : {}), ...(levelsOf(m.thinking) ? { thinking: levelsOf(m.thinking) } : {}), ...(hintsOf(m.thinkingHints) ? { thinkingHints: hintsOf(m.thinkingHints) } : {}), ...(LEVELS.includes(m.thinkingDefault as ThinkChoice) ? { thinkingDefault: m.thinkingDefault } : {}) }));
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
export function addOwnModel(provider: ProviderInfo, apiModel: string, details: { name?: string; agent?: boolean; contextTokens?: number; thinking?: ThinkChoice[]; thinkingHints?: Partial<Record<ThinkChoice, string>>; thinkingDefault?: ThinkChoice | null } = {}): OwnModel {
  const id = ownModelId(provider.id, apiModel);
  const before = getOwnModel(id);
  const model: OwnModel = {
    id,
    provider: provider.id,
    apiModel,
    name: details.name?.trim() || before?.name || apiModel,
    agent: details.agent ?? before?.agent ?? !provider.custom,
    ...((details.contextTokens ?? before?.contextTokens) ? { contextTokens: details.contextTokens ?? before?.contextTokens } : {}),
    ...((details.thinking ?? before?.thinking) ? { thinking: details.thinking ?? before?.thinking } : {}),
    ...((details.thinkingHints ?? before?.thinkingHints) ? { thinkingHints: details.thinkingHints ?? before?.thinkingHints } : {}),
    // null clears it (the model has no default any more).
    ...((details.thinkingDefault === undefined ? before?.thinkingDefault : details.thinkingDefault) ? { thinkingDefault: (details.thinkingDefault === undefined ? before?.thinkingDefault : details.thinkingDefault)! } : {}),
  };
  save([...ownModels().filter(m => m.id !== id), model]);
  return model;
}

export const removeOwnModel = (id: string): void => save(ownModels().filter(model => model.id !== id));
export const setOwnModelAgent = (id: string, agent: boolean): void => save(ownModels().map(model => (model.id === id ? { ...model, agent } : model)));
export const removeProviderModels = (provider: string): void => save(ownModels().filter(model => model.provider !== provider));
