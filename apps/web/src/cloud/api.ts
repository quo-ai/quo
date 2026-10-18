/** Calls to Quo's API. Every request carries an anonymous device id (for the free tier). */

const DEVICE_KEY = 'quo.device';

export function deviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export async function apiFetch(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`/api/${path}`, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: { 'content-type': 'application/json', 'x-quo-device': deviceId() },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: 'same-origin',
      signal: init.signal,
    });
  } catch (error) {
    if ((error as DOMException)?.name === 'AbortError') throw error;
    throw new ApiError(0, 'offline', 'You’re offline.');
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string; message?: string };
    throw new ApiError(response.status, body.error ?? `http_${response.status}`, body.message ?? 'Something went wrong. Try again.');
  }
  return response;
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  return (await apiFetch(path, init)).json() as Promise<T>;
}
