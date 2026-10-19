import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';

/** Shared by the Code mode server tests: a real request path into the API with the model provider stubbed. */

export const ctx = {} as { handleApi: typeof import('../routes.js').handleApi; config: typeof import('../env.js').config };

/** Loads the server after the environment is stubbed (each test file stubs it first). */
export async function loadServer() {
  ({ handleApi: ctx.handleApi } = await import('../routes.js'));
  ({ config: ctx.config } = await import('../env.js'));
  vi.spyOn(console, 'log').mockImplementation(() => {});
}

export const AGENT_MODEL = 'anthropic/claude-haiku-5.5';
export const READ_TOOLS = ['list_directory', 'read_file', 'find_files', 'search_text'];
export const ALL_TOOLS = [...READ_TOOLS, 'edit_file', 'write_file', 'run_command', 'open_repo'];

export function call(token: string | null, method: string, path: string, body?: unknown) {
  return ctx.handleApi(new Request(`http://localhost/api/${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-quo-device': randomUUID(), 'x-forwarded-for': '10.0.0.7', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), path.split('?')[0]);
}

export async function signIn(email: string): Promise<string> {
  const start = await (await call(null, 'POST', 'auth/start', { email })).json();
  return (await (await call(null, 'POST', 'auth/verify', { email, code: start.devCode, client: 'app' })).json()).token;
}

export async function events(response: Response) {
  const text = await response.text();
  return text.split('\n\n').filter(Boolean).map(block => {
    const [eventLine, dataLine] = block.split('\n');
    return { event: eventLine.replace('event: ', ''), data: JSON.parse(dataLine.replace('data: ', '')) };
  });
}

export const step = (token: string | null, extra: Record<string, unknown> = {}) =>
  call(token, 'POST', 'chat', {
    model: AGENT_MODEL,
    messages: [{ role: 'user', content: 'What is in this project?' }],
    agent: { tools: ALL_TOOLS, project: 'demo', platform: 'linux' },
    ...extra,
  });

/** An OpenRouter stream, as the server reads it. */
const upstream = (chunks: unknown[]) =>
  new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } });

export function stubUpstream(chunks: unknown[]) {
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
    requests.push({ url, body: JSON.parse(init.body) });
    return upstream(chunks);
  });
  ctx.config.openRouterKey = 'test-key';
  return requests;
}
