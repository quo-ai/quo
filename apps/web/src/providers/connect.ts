import { connectProvider, disconnectProvider } from './accounts';
import { ProviderError } from './errors';
import { listProviderModels, type ListedModel } from './listing';
import type { ProviderInfo } from './registry';
import type { Transport } from './transport';

/**
 * Saves a key and checks it by asking the provider for its models. A key the provider refuses is taken
 * straight back out, so a typo isn't left saved. If the check can't be made (offline, or the provider
 * has no model list) the key stays and the list is empty.
 */
export async function connectAndCheck(provider: ProviderInfo, key: string, transport?: Transport): Promise<ListedModel[]> {
  await connectProvider(provider.id, key);
  try {
    return await listProviderModels(provider, transport);
  } catch (error) {
    if (error instanceof ProviderError && error.code === 'provider_auth') {
      await disconnectProvider(provider.id);
      throw error;
    }
    return [];
  }
}
