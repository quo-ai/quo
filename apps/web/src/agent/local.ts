import { agentSystemPrompt, parseNotes, toolDefinitions, type Platform } from '../../shared/agentTools';
import type { LocalModel } from '../catalog';
import { localEngine } from '../engine/localEngine';
import { LOCAL_PROVIDER, localTransport } from '../engine/localTransport';
import { chatWithProvider } from '../providers/chat';
import { ProviderError } from '../providers/errors';
import type { Transport } from '../providers/transport';
import type { AgentMessage, StepReply } from './types';

/**
 * One step of Code mode on an offline model: the desktop app's own llama.cpp engine, which speaks the OpenAI format
 * (tool calls included), so the same adapter as for any provider reads it. Nothing leaves the computer.
 *
 * An agent session needs more room than a chat: files and tool results pile up. So the model is loaded with a larger
 * window for Code mode, tool results are kept short (the desktop app's "compact" sessions), and what is sent is cut
 * to fit that window.
 */

export const AGENT_CONTEXT = 32_768;
const AGENT_MAX_TOKENS = 4096;
/** The rules and the tool list take about this many tokens of the window. */
const FIXED_TOKENS = 3000;

/** How many characters of conversation fit the window, leaving room for the reply and the fixed part (about 3 characters a token). */
export const agentContextChars = (contextSize = AGENT_CONTEXT): number => Math.max(20_000, Math.floor((contextSize - AGENT_MAX_TOKENS - FIXED_TOKENS) * 3));

/**
 * Careful sampling for tool calls: low temperature, and none of the catalog's repetition penalties, which damage code
 * and JSON arguments. Thinking is off, which keeps each step quick.
 */
export const agentSampling = (model: LocalModel): Record<string, unknown> => ({
  temperature: Math.min(model.sampling.temperature, 0.4),
  top_p: 0.9,
  top_k: 40,
  min_p: 0.05,
  max_tokens: AGENT_MAX_TOKENS,
  ...(model.supportsThinking ? { chat_template_kwargs: { enable_thinking: false } } : {}),
});

/** Loads the model with room for a Code session. A no-op if it already is. */
export const prepareLocalAgent = (model: LocalModel): Promise<void> => localEngine.load(model, { contextSize: AGENT_CONTEXT });

export async function askLocalAgentModel(
  model: LocalModel,
  messages: AgentMessage[],
  options: { tools: string[]; project: string; platform: string; instructions?: { file: string; text: string } | null; /** Replaces the Code mode rules (a chat that only searches the web). */ system?: string; signal: AbortSignal; onText: (text: string) => void },
  transport: Transport = localTransport,
): Promise<StepReply> {
  const platform: Platform = options.platform === 'win32' || options.platform === 'darwin' ? options.platform : 'linux';
  const project = options.project.replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 60) || 'project';
  const system = options.system ?? agentSystemPrompt(project, platform, options.tools, parseNotes(options.instructions), 'local');
  const ask = () => chatWithProvider(
    LOCAL_PROVIDER,
    { model: model.id, maxTokens: AGENT_MAX_TOKENS, signal: options.signal, tools: toolDefinitions(options.tools), extra: agentSampling(model), messages: [{ role: 'system', content: system }, ...messages] },
    partial => options.onText(partial.content),
    transport,
  );
  let reply;
  try {
    try {
      reply = await ask();
    } catch (error) {
      // The engine can stop on its own (out of memory, a crash). Start it again, once.
      if (!(error instanceof ProviderError) || (error.status !== 503 && error.code !== 'provider_unreachable') || options.signal.aborted) throw error;
      await prepareLocalAgent(model);
      reply = await ask();
    }
  } catch (error) {
    if (error instanceof ProviderError && /context|exceed|too long|n_ctx/i.test(error.message)) {
      throw new ProviderError(400, 'context_full', 'The conversation no longer fits in the model’s memory. Start a new chat, or ask for something smaller.', error.provider);
    }
    throw error;
  }
  return { content: reply.content, toolCalls: reply.toolCalls, finish: reply.finish, charged: 0, balance: null };
}
