import type { ModelChoice } from '../models';
import { hasNativeEngine, webBridge } from '../native';
import { webSettings } from './settings';

/**
 * Whether, and how, a chat can search the web.
 *  - 'tools': the model is given search and page-reading tools that the desktop app runs (any model that can call
 *    tools: the user's own keys, offline models, and Quo's models while Code mode is on).
 *  - 'native': the provider searches itself (OpenRouter's web plugin, Anthropic's search tool), which is what works in
 *    a browser, where other sites can't be reached from the page.
 * Quo's own models use the second in a browser: the server asks OpenRouter to search once per message (a few a day on the
 * free model, credits on the others), so there it is a switch. On the desktop every model that can use tools gets the
 * first, and decides for itself when to search, with no switch (the settings say whether models may).
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

/** Whether a new chat on this model starts with web search on. Quo's own search is never on by itself: every message would search, and a search costs. */
export function webDefault(choice: ModelChoice | null, how: WebHow | null): boolean {
  if (choice?.kind === 'cloud' && how === 'native') return false;
  const settings = webSettings();
  return choice?.kind === 'local' ? settings.offline : settings.online;
}
