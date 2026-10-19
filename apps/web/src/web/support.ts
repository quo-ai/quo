import type { ModelChoice } from '../models';
import { hasNativeEngine, webBridge } from '../native';
import { webSettings } from './settings';

/**
 * Whether, and how, a chat can search the web.
 *  - 'tools': the model is given search and page-reading tools that the desktop app runs (any model that can call
 *    tools: the user's own keys, offline models, and Quo's models while Code mode is on).
 *  - 'native': the provider searches itself (OpenRouter's search tool, Anthropic's), which is what works in
 *    a browser, where other sites can't be reached from the page.
 * Either way the model decides for itself whether a message needs a search; there is no switch in the chat, and the
 * settings say whether models may search at all. Quo's own models in a browser get OpenRouter's search tool through the
 * server (one search a reply from a small daily allowance on the free model, a few paid with credits on the others).
 */

export type WebHow = 'tools' | 'native';

export function webHow(choice: ModelChoice | null, codeOn: boolean): WebHow | null {
  if (!choice) return null;
  // On the desktop a model that can use tools gets the search tools and decides for itself; the rest use Quo's own search.
  if (choice.kind === 'cloud') return webBridge() && (choice.model.agent || choice.model.agentLight) && (codeOn || choice.model.agentLight !== undefined) ? 'tools' : 'native';
  if (webBridge()) {
    if (choice.kind === 'own') return choice.model.agent ? 'tools' : choice.provider.custom ? null : nativeProvider(choice.provider.id);
    return hasNativeEngine() ? 'tools' : null;
  }
  return choice.kind === 'own' && !choice.provider.custom ? nativeProvider(choice.provider.id) : null;
}

const nativeProvider = (id: string): WebHow | null => (id === 'openrouter' || id === 'anthropic' ? 'native' : null);

/** Whether the settings let this model search the web (online models by default; offline models only when turned on). */
export function webAllowed(choice: ModelChoice | null): boolean {
  const settings = webSettings();
  return choice?.kind === 'local' ? settings.offline : settings.online;
}
