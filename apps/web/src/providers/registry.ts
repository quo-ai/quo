/**
 * The companies Quo can talk to with the user's own API key. Two wire formats cover
 * all of them: OpenAI's chat completions (which most providers copy) and Anthropic's
 * messages. A "custom" provider is any OpenAI-style server the user points Quo at,
 * such as Ollama or LM Studio on this computer.
 *
 * The desktop app keeps its own copy of the addresses (apps/desktop/src/providers/
 * registry.js), because it is the one that decides where a key is sent; a test keeps
 * the two the same.
 */

export type Protocol = 'openai' | 'anthropic';

export interface ProviderInfo {
  id: string;
  name: string;
  protocol: Protocol;
  baseUrl: string;
  /** Where a person gets a key. Built-in providers only. */
  keyUrl?: string;
  /** Whether the provider reports token counts in a stream when asked. */
  usage: boolean;
  /** A server the user added themselves. */
  custom?: boolean;
}

export const PROVIDERS: readonly ProviderInfo[] = [
  { id: 'openrouter', name: 'OpenRouter', protocol: 'openai', baseUrl: 'https://openrouter.ai/api/v1', keyUrl: 'https://openrouter.ai/keys', usage: true },
  { id: 'anthropic', name: 'Anthropic', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', keyUrl: 'https://console.anthropic.com/settings/keys', usage: true },
  { id: 'openai', name: 'OpenAI', protocol: 'openai', baseUrl: 'https://api.openai.com/v1', keyUrl: 'https://platform.openai.com/api-keys', usage: true },
  { id: 'google', name: 'Google Gemini', protocol: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', keyUrl: 'https://aistudio.google.com/apikey', usage: false },
  { id: 'xai', name: 'xAI', protocol: 'openai', baseUrl: 'https://api.x.ai/v1', keyUrl: 'https://console.x.ai', usage: true },
  { id: 'deepseek', name: 'DeepSeek', protocol: 'openai', baseUrl: 'https://api.deepseek.com', keyUrl: 'https://platform.deepseek.com/api_keys', usage: true },
  { id: 'mistral', name: 'Mistral', protocol: 'openai', baseUrl: 'https://api.mistral.ai/v1', keyUrl: 'https://console.mistral.ai/api-keys', usage: false },
  { id: 'groq', name: 'Groq', protocol: 'openai', baseUrl: 'https://api.groq.com/openai/v1', keyUrl: 'https://console.groq.com/keys', usage: true },
];

export const builtInProvider = (id: string): ProviderInfo | undefined => PROVIDERS.find(provider => provider.id === id);

/** A custom server's address, checked: https, or plain http only for this computer and local networks. Returns the cleaned address or null. */
export function cleanBaseUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
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

export const CUSTOM_ID = /^custom-[a-z0-9]{6,12}$/;
