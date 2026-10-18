import type { ToolResult } from '../agent/types';
import { NativeError, unwrap, webBridge } from '../native';

/** Addresses a person wrote in a message. The model may open those, exactly as written, and no others it didn't find. */
export function urlsIn(text: string): string[] {
  return [...new Set((text.match(/https?:\/\/[^\s<>"')\]]+/gi) ?? []).map(url => url.replace(/[.,;:!?]+$/, '')))].slice(0, 20);
}

/** Tells the desktop app which addresses the user wrote, before the model may be asked to open them. */
export async function allowUserUrls(sessionId: string, text: string): Promise<void> {
  const urls = urlsIn(text);
  if (urls.length) await webBridge()?.allow(sessionId, urls).catch(() => {});
}

/** Runs web_search or fetch_url in the desktop app. A failure comes back as words the model can read, never as an exception. */
export async function runWebTool(sessionId: string, name: string, args: Record<string, unknown>, compact: boolean): Promise<ToolResult> {
  const bridge = webBridge();
  if (!bridge) return { ok: false, text: 'Web access isn’t available here.', display: { kind: 'error' } };
  try {
    if (name === 'web_search') {
      const count = Number(args.count);
      const result = unwrap(await bridge.search(sessionId, String(args.query ?? ''), { count: Number.isFinite(count) && count > 0 ? count : undefined, compact }));
      return { ok: true, text: result.text, display: result.display };
    }
    if (name === 'fetch_url') {
      const result = unwrap(await bridge.read(sessionId, String(args.url ?? ''), { compact }));
      return { ok: true, text: result.text, display: result.display };
    }
    return { ok: false, text: `There’s no tool called ${name}.`, display: { kind: 'error' } };
  } catch (error) {
    return { ok: false, text: error instanceof NativeError ? error.message : 'That didn’t work.', display: { kind: 'error' } };
  }
}
