import { api } from './api';

/**
 * Invite links (https://app.quo.computer/?ref=<code>). The code is kept on this device until the person signs in, sent
 * once with the sign-in, then forgotten; the server decides whether it counts (server/referrals.ts: only for a new
 * account whose address never had the free trial). The address bar loses the code straight away.
 */
const KEY = 'quo.invite';
const CODE = /^[a-hjkmnp-z2-9]{8}$/;

export function rememberInvite(where: Pick<Location, 'search' | 'pathname' | 'hash'> = location): void {
  const params = new URLSearchParams(where.search);
  const code = params.get('ref');
  if (code === null) return;
  if (CODE.test(code)) {
    try {
      localStorage.setItem(KEY, code);
    } catch {
      // Storage off: the invite just doesn't count.
    }
  }
  params.delete('ref');
  const query = params.toString();
  history.replaceState(history.state, '', `${where.pathname}${query ? `?${query}` : ''}${where.hash}`);
}

export function pendingInvite(): string | undefined {
  try {
    const code = localStorage.getItem(KEY);
    return code && CODE.test(code) ? code : undefined;
  } catch {
    return undefined;
  }
}

export function forgetInvite(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to forget.
  }
}

export interface Invite {
  code: string;
  link: string;
  /** Friends whose first purchase earned the person credits, and the most that can. */
  rewarded: number;
  max: number;
  forFriend: number;
  forYou: number;
}

export const loadInvite = () => api<Invite>('referral');
