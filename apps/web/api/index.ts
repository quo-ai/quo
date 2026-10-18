import { handleApi } from '../server/routes.js';

/**
 * Vercel Function for every /api/* route (vercel.json rewrites /api/<path>
 * to /api?path=<path>). The API itself is plain Web Request → Response
 * (server/routes.ts), so it runs unchanged here, on the dev server and on
 * the standalone server (server/serve.ts).
 */
function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.searchParams.get('path') ?? url.pathname.replace(/^\/api\/?/, '');
  return handleApi(request, path);
}

export const GET = handle;
export const POST = handle;
