import type { ModelChoice } from '../models';
import { hasNativeEngine, webBridge } from '../native';
import { webSettings } from './settings';

/**
 * Whether, and how, a chat can search the web.
 *  - 'tools': the model is given search and page-reading tools that the desktop app runs (any model that can call
 *    tools: the user's own keys, offline models, and Quo's models while Code mode is on).
 *  - 'native': the provider searches itself (OpenRouter's web plugin, Anthropic's search tool), which is what works in
 *    a browser, where other sites can't be reached from the page.
 * Quo's own free model isn't offered web search: every search costs money.
 */

export type WebHow = 'tools' | 'native';

export function webHow(choice: ModelChoice | null, codeOn: boolean): WebHow | null {
  if (!choice) return null;
  if (webBridge()) {
    if (choice.kind === 'cloud') return codeOn && choice.model.agent ? 'tools' : null;
    if (choice.kind === 'own') return choice.model.agent ? 'tools' : choice.provider.custom ? null : nativeProvider(choice.provider.id);
    return hasNativeEngine() ? 'tools' : null;
  }
  return choice.kind === 'own' && !choice.provider.custom ? nativeProvider(choice.provider.id) : null;
}

const nativeProvider = (id: string): WebHow | null => (id === 'openrouter' || id === 'anthropic' ? 'native' : null);

/** Whether a new chat on this model starts with web search on. */
export function webDefault(choice: ModelChoice | null): boolean {
  const settings = webSettings();
  return choice?.kind === 'local' ? settings.offline : settings.online;
}
