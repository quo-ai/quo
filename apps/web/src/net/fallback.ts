import { useCallback, useEffect, useRef } from 'react';
import type { LocalModel } from '../catalog';
import { choiceKey, lastLocalKey, type ModelChoice } from '../models';
import { isLocalHost } from '../providers/registry';
import type { Failure } from '../ui/chat/types';
import { toast } from '../ui/Toasts';
import { fallbackSetting, useFallbackSetting } from './settings';
import { useOnline } from './status';

/** Whether a model needs the internet to answer. A server on this computer or network, and offline models, don't. */
export function needsInternet(choice: ModelChoice | null): boolean {
  if (!choice || choice.kind === 'local') return false;
  if (choice.kind === 'cloud') return true;
  return !(choice.provider.custom && isLocalHost(new URL(choice.provider.baseUrl).hostname));
}

/** Why a turn failed, when moving to the offline model is the way on. */
const REASONS: Record<string, string> = {
  offline: 'You’re offline.',
  provider_unreachable: 'The provider can’t be reached.',
  free_limit: 'Today’s free messages are used up.',
  insufficient_credits: 'You’re out of credits.',
  provider_credit: 'Your account with the provider is out of credit.',
  provider_auth: 'The provider didn’t accept your key.',
};

/**
 * Keeps chats going when the model picked can't be used because of the connection or the account, as the user chose
 * (Models & storage → Web): move to their offline model by itself, ask first, or do nothing. It only ever moves toward
 * the offline model, never to a cloud one, and when the connection is back it only offers to return.
 */
export function useFallback({ choice, installed, select }: { choice: ModelChoice | null; installed: LocalModel[]; select: (key: string) => void }) {
  const online = useOnline();
  useFallbackSetting();
  const latest = useRef({ choice, installed, select });
  latest.current = { choice, installed, select };
  const left = useRef<{ key: string; name: string } | null>(null);
  const handled = useRef(false);

  /** Returns true if the chat was moved to the offline model. */
  const moveToOffline = useCallback((reason: string): boolean => {
    const { choice, installed, select } = latest.current;
    const setting = fallbackSetting();
    if (!choice || !needsInternet(choice) || setting === 'off') return false;
    const last = lastLocalKey();
    const model = installed.find(m => `local:${m.id}` === last) ?? installed[0];
    if (!model) {
      toast(`${reason} Download an offline model to keep chatting without a connection.`, { durationMs: 6000 });
      return false;
    }
    const from = { key: choiceKey(choice), name: choice.model.name };
    const go = () => {
      left.current = from;
      select(`local:${model.id}`);
    };
    if (setting === 'ask') {
      toast(`${reason} Switch to ${model.name}?`, { action: { label: 'Switch', run: go }, durationMs: 10_000 });
      return false;
    }
    go();
    toast(`${reason} Switched to ${model.name}.`, { action: { label: 'Undo', run: () => { left.current = null; select(from.key); } }, durationMs: 8000 });
    return true;
  }, []);

  const key = choice ? choiceKey(choice) : null;
  useEffect(() => {
    if (online) {
      handled.current = false;
      const from = left.current;
      left.current = null;
      if (from && latest.current.choice?.kind === 'local') {
        toast(`You’re back online. Use ${from.name} again?`, { action: { label: 'Use it', run: () => latest.current.select(from.key) }, durationMs: 10_000 });
      }
    } else if (!handled.current && key) {
      // Once per time offline, so picking a cloud model on purpose afterwards isn't undone.
      handled.current = true;
      moveToOffline(REASONS.offline);
    }
  }, [online, key, moveToOffline]);

  /** A turn failed: if that is a reason to move, do (or offer), and say whether the chat moved so it can run again there. */
  const onFailure = useCallback((failure: Failure): boolean => {
    const reason = REASONS[failure.code];
    return reason ? moveToOffline(reason) : false;
  }, [moveToOffline]);

  return { onFailure };
}
