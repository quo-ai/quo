import type { ProviderInfo } from './registry';

/** The headers a provider wants, with the key. In a browser, Anthropic also needs to be told the key is the user's own. */
export function headersFor(provider: ProviderInfo, key: string | null, method: 'GET' | 'POST', inBrowser: boolean): Record<string, string> {
  const headers: Record<string, string> = { accept: method === 'POST' ? 'text/event-stream' : 'application/json' };
  if (method === 'POST') headers['content-type'] = 'application/json';
  if (provider.protocol === 'anthropic') {
    if (key) headers['x-api-key'] = key;
    headers['anthropic-version'] = '2023-06-01';
    if (inBrowser) headers['anthropic-dangerous-direct-browser-access'] = 'true';
  } else if (key) headers.authorization = `Bearer ${key}`;
  return headers;
}
