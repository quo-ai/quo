import type { LocalModel } from './catalog';
import type { CloudCatalog, CloudModel } from './cloud/catalog';
import type { OwnModel } from './providers/ownModels';
import type { ProviderAccount } from './providers/accounts';
import type { ProviderInfo } from './providers/registry';

/** The model a chat runs on: on this device, in the cloud via Quo's API, or at a provider the user reaches with their own key. */
export type ModelChoice =
  | { kind: 'local'; model: LocalModel }
  | { kind: 'cloud'; model: CloudModel }
  | { kind: 'own'; model: OwnModel; provider: ProviderInfo };

export const choiceKey = (choice: ModelChoice): string => `${choice.kind}:${choice.model.id}`;

/** Context budget for cloud models (they accept far more; this keeps cost per message sane). */
export const CLOUD_CONTEXT = { contextSize: 32_768, maxTokens: 4_096 };

/**
 * The model chats run on. Offline first: a cloud model, or one at a provider, is only ever used when the
 * user picked it; otherwise the chosen (or first) installed offline model.
 */
export function resolveChoice(key: string | null, installed: LocalModel[], catalog: CloudCatalog | null, own: OwnModel[], providers: ProviderAccount[]): ModelChoice | null {
  if (key?.startsWith('cloud:')) {
    const model = catalog?.models.find(m => `cloud:${m.id}` === key);
    if (model) return { kind: 'cloud', model };
  }
  if (key?.startsWith('own:')) {
    const model = own.find(m => `own:${m.id}` === key);
    const account = model && providers.find(p => p.info.id === model.provider);
    if (model && account && (account.configured || account.info.custom)) return { kind: 'own', model, provider: account.info };
  }
  const local = installed.find(m => `local:${m.id}` === key) ?? installed[0];
  return local ? { kind: 'local', model: local } : null;
}

const CHOICE_KEY = 'quo.choice';
/** Earlier versions stored only the local model id. */
const LEGACY_MODEL_KEY = 'quo.activeModel';

export const rememberChoice = (key: string): void => localStorage.setItem(CHOICE_KEY, key);

export function storedChoiceKey(): string | null {
  const key = localStorage.getItem(CHOICE_KEY);
  if (key) return key;
  const legacy = localStorage.getItem(LEGACY_MODEL_KEY);
  return legacy ? `local:${legacy}` : null;
}

