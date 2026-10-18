import { useSyncExternalStore } from 'react';
import { providersBridge, unwrap } from '../native';
import { browserEndpoints, browserKeys, type CustomEndpoint } from './browserKeys';
import { cleanBaseUrl, PROVIDERS, type ProviderInfo, type Protocol } from './registry';

/**
 * The providers the user can connect, and which of them have a key. The desktop app holds the keys and the
 * custom servers (the page can store a key but never read it back); in a browser they are kept in that
 * browser. Either way the rest of the app sees the same thing.
 */

export interface ProviderAccount {
  info: ProviderInfo;
  configured: boolean;
  last4: string | null;
}

export interface ProviderSnapshot {
  accounts: ProviderAccount[];
  /** Where keys are kept: the system's secure storage, this session's memory only, or this browser. */
  storage: 'system' | 'memory' | 'browser';
  ready: boolean;
}

const customInfo = (entry: CustomEndpoint): ProviderInfo => ({ id: entry.id, name: entry.name, protocol: entry.protocol, baseUrl: entry.baseUrl, usage: false, custom: true });

let snapshot: ProviderSnapshot = { accounts: PROVIDERS.map(info => ({ info, configured: false, last4: null })), storage: providersBridge() ? 'system' : 'browser', ready: false };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());

/** Reads the current state from wherever keys are kept. */
export async function refreshProviders(): Promise<void> {
  const bridge = providersBridge();
  let custom: CustomEndpoint[];
  let configured: Map<string, string | null>;
  let storage: ProviderSnapshot['storage'] = 'browser';
  if (bridge) {
    const listing = unwrap(await bridge.list());
    custom = listing.custom;
    configured = new Map(listing.keys.filter(state => state.configured).map(state => [state.id, state.last4]));
    storage = listing.secure ? 'system' : 'memory';
  } else {
    custom = browserEndpoints.list();
    configured = new Map();
    for (const id of [...PROVIDERS.map(p => p.id), ...custom.map(e => e.id)]) {
      const key = browserKeys.get(id);
      if (key) configured.set(id, key.slice(-4));
    }
  }
  const infos = [...PROVIDERS, ...custom.map(customInfo)];
  snapshot = { accounts: infos.map(info => ({ info, configured: configured.has(info.id), last4: configured.get(info.id) ?? null })), storage, ready: true };
  emit();
}

export const providerSnapshot = (): ProviderSnapshot => snapshot;
export const providerById = (id: string): ProviderInfo | undefined => snapshot.accounts.find(account => account.info.id === id)?.info;

export function useProviders(): ProviderSnapshot {
  return useSyncExternalStore(listener => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, providerSnapshot);
}

/** Saves a key for a provider. */
export async function connectProvider(id: string, key: string): Promise<void> {
  const bridge = providersBridge();
  if (bridge) unwrap(await bridge.setKey(id, key));
  else {
    const clean = key.trim();
    if (!/^[\x21-\x7e]{8,500}$/.test(clean)) throw new Error('That doesn’t look like an API key. A key has no spaces or line breaks.');
    browserKeys.set(id, clean);
  }
  await refreshProviders();
}

export async function disconnectProvider(id: string): Promise<void> {
  const bridge = providersBridge();
  if (bridge) unwrap(await bridge.clearKey(id));
  else browserKeys.clear(id);
  await refreshProviders();
}

export interface CustomInput {
  id?: string;
  name: string;
  baseUrl: string;
  protocol: Protocol;
  key?: string;
}

/** Adds a server of the user's own (Ollama, LM Studio, a gateway), or updates one. Changing its address removes its key. */
export async function saveCustomProvider(input: CustomInput): Promise<ProviderInfo> {
  const bridge = providersBridge();
  let entry: CustomEndpoint;
  if (bridge) entry = unwrap(await bridge.saveCustom(input));
  else {
    const baseUrl = cleanBaseUrl(input.baseUrl);
    if (!baseUrl) throw new Error('That address won’t work. Use https://…, or http:// for a server on this computer or your own network.');
    const name = input.name.trim().slice(0, 40);
    if (!name) throw new Error('Give the server a name.');
    const before = input.id ? browserEndpoints.list().find(e => e.id === input.id) : undefined;
    entry = { id: before?.id ?? `custom-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`, name, baseUrl, protocol: input.protocol };
    browserEndpoints.save(entry);
    if (before && (before.baseUrl !== baseUrl || before.protocol !== input.protocol)) browserKeys.clear(entry.id);
    if (input.key?.trim()) browserKeys.set(entry.id, input.key.trim());
  }
  await refreshProviders();
  return customInfo(entry);
}

export async function removeCustomProvider(id: string): Promise<void> {
  const bridge = providersBridge();
  if (bridge) unwrap(await bridge.removeCustom(id));
  else {
    browserKeys.clear(id);
    browserEndpoints.remove(id);
  }
  await refreshProviders();
}
