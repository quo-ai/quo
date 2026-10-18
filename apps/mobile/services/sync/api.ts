import { SYNC_API_ORIGIN } from '@/constants/sync';
import type { SyncApi } from './engine';
import { getDeviceId, getToken } from './tracking';

/** Calls to Quo's API (the same one Quo Web uses), signed in with a bearer token from secure storage. */

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

const TIMEOUT_MS = 30_000;

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = await getToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${SYNC_API_ORIGIN}/api/${path}`, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: {
        'content-type': 'application/json',
        'x-quo-device': await getDeviceId(),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(0, 'offline', 'You’re offline, or Quo can’t be reached.');
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new ApiError(response.status, body.error ?? `http_${response.status}`, body.message ?? 'Something went wrong. Try again.');
  }
  return (await response.json()) as T;
}

/** The sync engine's view of the server. */
export const remoteApi: SyncApi = {
  status: () => api('sync/status'),
  pull: (since, kinds) => api(`sync/pull?since=${since}&kinds=${kinds.join(',')}`),
  push: records => api('sync/push', { body: { records } }),
};
