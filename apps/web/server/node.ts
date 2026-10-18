import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Node `http` ⇄ Web Request/Response, streaming both ways (server-sent
 * events for chat). Used by the dev server (vite.config.ts) and the
 * standalone server (server/serve.ts).
 */

// Cross-origin isolation enables SharedArrayBuffer, which wllama needs for
// multi-threaded CPU inference. The Paddle checkout page is exempt: it embeds
// Paddle's checkout, which can't run cross-origin isolated.
export const ISOLATION_EXEMPT = ['/checkout.html'];

export function setIsolationHeaders(path: string, res: ServerResponse): void {
  if (ISOLATION_EXEMPT.includes(path)) return;
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
}

export async function toWebRequest(req: IncomingMessage, res: ServerResponse): Promise<Request> {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach(v => headers.append(key, v));
    else if (value !== undefined) headers.set(key, value);
  }
  if (!headers.has('x-forwarded-for') && req.socket.remoteAddress) headers.set('x-forwarded-for', req.socket.remoteAddress);
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });
  let body: Buffer | undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    body = Buffer.concat(chunks);
  }
  return new Request(`http://${req.headers.host ?? 'localhost'}${req.url}`, {
    method: req.method,
    headers,
    body: body ? new Uint8Array(body) : undefined,
    signal: controller.signal,
  });
}

export async function sendWebResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    if (key !== 'set-cookie') res.setHeader(key, value);
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) res.setHeader('set-cookie', cookies);
  if (!response.body) return void res.end();
  res.flushHeaders();
  for await (const chunk of response.body) {
    if (res.destroyed) break;
    res.write(chunk);
  }
  res.end();
}
