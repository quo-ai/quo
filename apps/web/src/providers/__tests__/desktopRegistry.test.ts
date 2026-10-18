import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { adapterFor } from '../chat';
import { cleanBaseUrl, PROVIDERS } from '../registry';

// The desktop app decides where a key is sent, from its own copy of this list. The two must say the same.
const require = createRequire(import.meta.url);
const desktop = require('../../../../desktop/src/providers/registry.js') as {
  BUILT_IN: Record<string, { protocol: string; baseUrl: string }>;
  allowed: (protocol: string, method: string, path: string) => boolean;
  cleanBaseUrl: (input: unknown) => string | null;
};

describe('the desktop app’s list of providers', () => {
  it('has the same providers, addresses and wire formats as the web app’s', () => {
    expect(Object.keys(desktop.BUILT_IN).sort()).toEqual(PROVIDERS.map(p => p.id).sort());
    for (const provider of PROVIDERS) expect(desktop.BUILT_IN[provider.id], provider.id).toEqual({ protocol: provider.protocol, baseUrl: provider.baseUrl });
  });

  it('allows exactly the calls the web app makes', () => {
    for (const provider of PROVIDERS) {
      expect(desktop.allowed(provider.protocol, 'POST', adapterFor(provider).path), provider.id).toBe(true);
      expect(desktop.allowed(provider.protocol, 'GET', provider.protocol === 'anthropic' ? '/models?limit=1000' : '/models'), provider.id).toBe(true);
    }
  });

  it('judges a custom server’s address the same way', () => {
    for (const address of ['https://llm.example.com/v1/', 'http://localhost:11434/v1', 'http://192.168.0.9:1234', 'http://example.com', 'ftp://x', 'https://u:p@h', 'https://h/v1?q=1', 'garbage', '']) {
      expect(desktop.cleanBaseUrl(address), address).toBe(cleanBaseUrl(address));
    }
  });
});
