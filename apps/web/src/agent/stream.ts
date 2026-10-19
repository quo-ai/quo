import { apiFetch, ApiError } from '../cloud/api';
import { readEvents } from '../cloud/sse';
import { deviceInfo } from '../chat/environment';
import type { AgentMessage, StepReply } from './types';

/**
 * One request to the model in Code mode: the conversation so far goes to /api/chat
 * with `agent` set, and the reply comes back as text (streamed) plus any tools the
 * model wants to call. The server adds its own instructions and the tool list.
 */
export async function askAgentModel(
  modelId: string,
  messages: AgentMessage[],
  options: { tools: string[]; project: string; platform: string; instructions?: { file: string; text: string } | null; signal: AbortSignal; onText: (text: string) => void; /** A helper started by the task tool: read-only, with its own prompt. */ role?: 'explore' | 'summarize' },
): Promise<StepReply> {
  const response = await apiFetch('chat', {
    body: { model: modelId, messages, agent: { tools: options.tools, project: options.project, platform: options.platform, environment: deviceInfo(), ...(options.role ? { role: options.role } : {}), ...(options.instructions ? { instructions: options.instructions } : {}) } },
    signal: options.signal,
  });
  const reply: StepReply = { content: '', toolCalls: [], finish: null, charged: 0, balance: null };
  await readEvents(response, (event, payload) => {
    if (event === 'delta') {
      reply.content += (payload.c as string | undefined) ?? '';
      options.onText(reply.content);
    } else if (event === 'tool_calls') {
      reply.toolCalls = (payload.calls as StepReply['toolCalls']) ?? [];
      reply.finish = (payload.finish as string | null) ?? null;
    } else if (event === 'done') {
      reply.charged = (payload.charged as number | undefined) ?? 0;
      reply.balance = (payload.balance as number | null | undefined) ?? null;
      reply.finish = (payload.finish as string | null | undefined) ?? reply.finish;
    } else if (event === 'error') {
      throw new ApiError(502, payload.error as string, payload.message as string);
    }
  });
  return reply;
}
