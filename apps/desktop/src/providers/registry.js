'use strict';

/**
 * Where each provider's API is, and which wire format it speaks. This is the one place that decides where a
 * key is sent, so it lives here in the main process; the web app has its own copy for names and links
 * (apps/web/src/providers/registry.ts), and a test keeps the two the same. A provider's address can't be
 * changed from the page: only the servers the user adds (with an address of their own) can have any other.
 */

const BUILT_IN = {
  openrouter: { protocol: 'openai', baseUrl: 'https://openrouter.ai/api/v1' },
  anthropic: { protocol: 'anthropic', baseUrl: 'https://api.anthropic.com/v1' },
  openai: { protocol: 'openai', baseUrl: 'https://api.openai.com/v1' },
  google: { protocol: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  xai: { protocol: 'openai', baseUrl: 'https://api.x.ai/v1' },
  deepseek: { protocol: 'openai', baseUrl: 'https://api.deepseek.com' },
  mistral: { protocol: 'openai', baseUrl: 'https://api.mistral.ai/v1' },
  groq: { protocol: 'openai', baseUrl: 'https://api.groq.com/openai/v1' },
};

const CUSTOM_ID = /^custom-[a-z0-9]{6,12}$/;
const PROTOCOLS = new Set(['openai', 'anthropic']);

/** A custom server's address, checked: https, or plain http only for this computer and local networks. Returns the cleaned address or null. */
function cleanBaseUrl(input) {
  let url;
  try {
    url = new URL(String(input).trim());
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) return null;
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const local = host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '::1'
    || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (url.protocol === 'http:' ? !local : url.protocol !== 'https:') return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

// What may be asked of a provider, by wire format: the chat call and the model list, nothing else.
const ALLOWED = {
  openai: [['POST', /^\/chat\/completions$/], ['GET', /^\/models$/]],
  anthropic: [['POST', /^\/messages$/], ['GET', /^\/models(\?limit=\d{1,4})?$/]],
};

const allowed = (protocol, method, path) => (ALLOWED[protocol] ?? []).some(([m, pattern]) => m === method && pattern.test(path));

module.exports = { BUILT_IN, CUSTOM_ID, PROTOCOLS, cleanBaseUrl, allowed };
