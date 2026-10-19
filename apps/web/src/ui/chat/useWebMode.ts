import { useEffect, useState } from 'react';
import type { ModelChoice } from '../../models';
import { useOnline } from '../../net/status';
import { webDefault, webHow, type WebHow } from '../../web/support';
import { useWebSettings } from '../../web/settings';

/**
 * Web search for one chat: whether it can be offered for this model, whether the connection allows it, and whether it is
 * on. It starts as the settings say (on for the user's own keys and Code mode, off for offline models) and the Web
 * chip changes it for this chat; Quo's chat models never start with it on, because each message would search and a
 * search costs. Offline, it is off and can't be turned on.
 */
export function useWebMode(choice: ModelChoice | null, codeOn: boolean, conversationId: string | undefined) {
  const online = useOnline();
  useWebSettings();
  const how: WebHow | null = webHow(choice, codeOn);
  const modelId = choice?.model.id;
  const [override, setOverride] = useState<boolean | null>(null);
  // A different chat or model starts from the settings again.
  useEffect(() => setOverride(null), [modelId, conversationId]);
  const wanted = override ?? webDefault(choice, how);
  return {
    how,
    online,
    /** Can be switched on now. */
    usable: how !== null && online,
    on: how !== null && online && wanted,
    toggle: () => setOverride(!wanted),
  };
}

export type WebMode = ReturnType<typeof useWebMode>;
