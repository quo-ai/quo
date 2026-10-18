import { useSyncExternalStore } from 'react';

/**
 * Whether this computer can reach the internet. The browser's own flag is a start but not the truth (a Wi-Fi
 * network with no internet still says "online"), so a failed request asks again by trying Quo's own address, and
 * keeps trying while offline. Nothing is contacted while everything works: this never pings anyone else.
 */

let offline = typeof navigator !== 'undefined' && navigator.onLine === false;
let probing: ReturnType<typeof setTimeout> | null = null;
let checking: Promise<void> | null = null;
const listeners = new Set<() => void>();

const RETRY_MS = 10_000;

function set(next: boolean): void {
  if (offline === next) return;
  offline = next;
  listeners.forEach(listener => listener());
}

/** Reaching Quo's address at all (whatever it answers) means the network works. The desktop app answers 503 "offline" itself when it can't get through. */
export async function reachable(fetchFn: typeof fetch = (...args) => fetch(...args)): Promise<boolean> {
  try {
    const response = await fetchFn('/api/models', { cache: 'no-store', signal: AbortSignal.timeout(6000) });
    if (response.status === 503) {
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (body?.error === 'offline') return false;
    }
    return true;
  } catch {
    return false;
  }
}

function check(): Promise<void> {
  return (checking ??= reachable().then(up => {
    checking = null;
    set(!up);
    if (up) {
      if (probing) clearTimeout(probing);
      probing = null;
    } else if (!probing) {
      probing = setTimeout(() => {
        probing = null;
        void check();
      }, RETRY_MS);
    }
  }));
}

/** A request failed to connect: find out whether the internet is really down. */
export function reportNetworkFailure(): void {
  void check();
}

if (typeof window !== 'undefined') {
  window.addEventListener('offline', () => {
    set(true);
    void check();
  });
  window.addEventListener('online', () => void check());
  if (offline) void check();
}

export const isOnline = (): boolean => !offline;

export function useOnline(): boolean {
  return useSyncExternalStore(listener => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, isOnline);
}

/** For tests. */
export function resetStatus(value = false): void {
  offline = value;
  checking = null;
  if (probing) clearTimeout(probing);
  probing = null;
}
