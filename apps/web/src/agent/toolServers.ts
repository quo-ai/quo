import { TOOL_SERVER_PREFIX, toolServerTools, type ToolServerTool } from '../../shared/agentTools';
import { unwrap } from '../native';
import type { ToolResult } from './types';

/**
 * Tool servers (MCP) the person added in the desktop app (apps/desktop/src/mcp/): their tools go to the chat's model
 * beside Quo's own, and every call is asked about in the desktop app's approval window before it runs.
 */

/** An offline model's window is small: tool descriptions take room from the conversation. */
export const COMPACT_TOOL_SERVER_TOOLS = 12;

const bridge = () => (typeof window === 'undefined' ? null : window.quoDesktop?.toolServers ?? null);

export const isToolServerTool = (name: string): boolean => name.startsWith(TOOL_SERVER_PREFIX);

/** The tools of the servers that are on, checked; none outside the desktop app or when none are on. */
export async function toolServersFor(compact: boolean): Promise<ToolServerTool[]> {
  const servers = bridge();
  if (!servers) return [];
  try {
    const tools = toolServerTools(unwrap(await servers.tools()));
    return compact ? tools.slice(0, COMPACT_TOOL_SERVER_TOOLS) : tools;
  } catch {
    return [];
  }
}

/** A tool server's tool in a chat without a folder: the desktop app asks the person first, then runs it. */
export async function runToolServerTool(chatId: string, name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<ToolResult> {
  const servers = bridge();
  if (!servers) return { ok: false, text: 'Tool servers work in the desktop app.', display: { kind: 'error' } };
  const stop = () => void servers.abort(chatId);
  signal.addEventListener('abort', stop, { once: true });
  try {
    return unwrap(await servers.call(chatId, name, args));
  } catch (error) {
    return { ok: false, text: error instanceof Error ? error.message : 'The tool server didn’t answer.', display: { kind: 'error' } };
  } finally {
    signal.removeEventListener('abort', stop);
  }
}
