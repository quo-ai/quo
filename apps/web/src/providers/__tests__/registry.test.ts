import { describe, expect, it } from 'vitest';
import { cleanBaseUrl, PROVIDERS } from '../registry';

describe('the list of providers', () => {
  it('has unique ids and https addresses without a trailing slash', () => {
    expect(new Set(PROVIDERS.map(p => p.id)).size).toBe(PROVIDERS.length);
    for (const provider of PROVIDERS) {
      expect(provider.baseUrl, provider.id).toMatch(/^https:\/\/[^/]+(\/[^/]+)*[^/]$/);
      expect(provider.keyUrl, provider.id).toMatch(/^https:\/\//);
    }
  });
});

describe('the address of a server the user adds', () => {
  it('takes https, and plain http only for this computer or a local network', () => {
    expect(cleanBaseUrl('https://llm.example.com/v1/')).toBe('https://llm.example.com/v1');
    expect(cleanBaseUrl('  http://localhost:11434/v1 ')).toBe('http://localhost:11434/v1');
    expect(cleanBaseUrl('http://127.0.0.1:1234/v1')).toBe('http://127.0.0.1:1234/v1');
    expect(cleanBaseUrl('http://[::1]:8080')).toBe('http://[::1]:8080');
    expect(cleanBaseUrl('http://192.168.1.20:8000/v1')).toBe('http://192.168.1.20:8000/v1');
    expect(cleanBaseUrl('http://10.0.0.5/v1')).toBe('http://10.0.0.5/v1');
    expect(cleanBaseUrl('http://172.20.1.1/v1')).toBe('http://172.20.1.1/v1');
    expect(cleanBaseUrl('http://mybox.local:8080/v1')).toBe('http://mybox.local:8080/v1');
  });

  it('refuses plain http over the internet, other schemes, and anything carrying credentials or a query', () => {
    for (const bad of ['http://llm.example.com/v1', 'http://172.32.0.1/v1', 'http://8.8.8.8', 'ftp://localhost/v1', 'file:///etc/passwd', 'javascript:alert(1)', 'https://user:pw@host/v1', 'https://host/v1?key=1', 'https://host/v1#x', 'not a url', '']) {
      expect(cleanBaseUrl(bad), bad).toBeNull();
    }
  });
});
