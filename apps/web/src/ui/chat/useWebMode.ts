import type { ModelChoice } from '../../models';
import { useOnline } from '../../net/status';
import { webAllowed, webHow, type WebHow } from '../../web/support';
import { useWebSettings } from '../../web/settings';

/**
 * Web search for one chat: whether this model can search, and whether it may now. There is no switch in the chat: the
 * model decides for itself when a message needs a search (with search tools, or the provider's own search tool), and
 * the settings say whether models may search at all (online models yes, offline models no, by default). Offline, it is off.
 */
export function useWebMode(choice: ModelChoice | null, codeOn: boolean) {
  const online = useOnline();
  useWebSettings();
  const how: WebHow | null = webHow(choice, codeOn);
  return {
    how,
    online,
    /** The model may search for this message, if it decides to. */
    on: how !== null && online && webAllowed(choice),
  };
}

export type WebMode = ReturnType<typeof useWebMode>;
