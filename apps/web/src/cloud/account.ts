import { isDesktopApp, openExternal, WEB_APP_URL } from '../platform';
import { api, ApiError } from './api';

/** Account state (signed-in user, plan, credits, free allowance), shared app-wide. */

export interface Account {
  user: { email: string } | null;
  plan: 'free' | 'pro';
  /** Quo Sync is included (Pro, or the Sync plan). */
  sync?: boolean;
  subscription: { plan: string; status: string; renewsAt: string | null } | null;
  credits: number | null;
  free: { limit: number; remaining: number };
  billing: { live: boolean };
  /** Which services the server has set up (anything off answers `setup_required`). */
  features: { cloud: boolean; accounts: boolean; billing: boolean };
}

export type ProductId = 'pro_monthly' | 'pro_yearly' | 'sync_yearly' | 'pack_1000' | 'pack_2750' | 'pack_6000';

let current: Account | null = null;
const listeners = new Set<(account: Account | null) => void>();

function set(next: Account | null) {
  current = next;
  listeners.forEach(listener => listener(current));
}

export function getAccount(): Account | null {
  return current;
}

export function subscribeAccount(listener: (account: Account | null) => void): () => void {
  listeners.add(listener);
  listener(current);
  return () => listeners.delete(listener);
}

export async function refreshAccount(): Promise<void> {
  try {
    set(await api<Account>('me'));
  } catch {
    // Offline: keep what we have.
  }
}

/** Updates from a finished cloud reply (new balance / free messages left). */
export function applyUsage(update: { balance: number | null; freeRemaining: number | null }): void {
  if (!current) return;
  set({
    ...current,
    credits: update.balance ?? current.credits,
    free: update.freeRemaining === null ? current.free : { ...current.free, remaining: update.freeRemaining },
  });
}

export async function startSignIn(email: string): Promise<{ devCode?: string }> {
  return api<{ ok: boolean; devCode?: string }>('auth/start', { body: { email } });
}

export async function verifySignIn(email: string, code: string): Promise<void> {
  set(await api<Account>('auth/verify', { body: { email, code } }));
}

export async function signOut(): Promise<void> {
  await api('auth/signout', { body: {} });
  await refreshAccount();
}

/**
 * Sends the browser to checkout (Paddle, or the sandbox's simulated purchase).
 * The desktop app opens it in the system browser instead; the purchase is tied
 * to the account server-side, and the app refreshes the balance on focus.
 */
export async function checkout(product: ProductId): Promise<void> {
  const { url } = await api<{ url: string }>('billing/checkout', { body: { product } });
  if (isDesktopApp()) openExternal(new URL(url, WEB_APP_URL).href);
  else window.location.href = url;
}

export async function openBillingPortal(): Promise<string | null> {
  const { url, message } = await api<{ url: string | null; message?: string }>('billing/portal', { body: {} });
  if (url) window.open(url, '_blank', 'noopener');
  return url ? null : message ?? null;
}

export { ApiError };
