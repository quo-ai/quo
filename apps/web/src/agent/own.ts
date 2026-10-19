import type { Environment } from '../../shared/environment';
import { agentSystemPrompt, parseNotes, toolDefinitions, type Platform } from '../../shared/agentTools';
import { chatWithProvider } from '../providers/chat';
import type { OwnModel } from '../providers/ownModels';
import type { ProviderInfo } from '../providers/registry';
import type { AgentMessage, StepReply } from './types';

/**
 * One step of Code mode on a model reached with the user's own key: the same system prompt and tools as with
 * Quo's cloud models (shared/agentTools.ts), but the request goes from this computer straight to the provider.
 * Nothing is charged by Quo.
 */

const AGENT_MAX_TOKENS = 8192;

export async function askOwnAgentModel(
  provider: ProviderInfo,
  model: OwnModel,
  messages: AgentMessage[],
  options: { tools: string[]; project: string; platform: string; instructions?: { file: string; text: string } | null; /** A helper started by the task tool: read-only, with its own prompt. */ role?: 'explore' | 'summarize'; /** Told to the model: the date, the program, what it can do. */ environment?: Environment; /** Replaces the Code mode rules (a chat that only searches the web). */ system?: string; signal: AbortSignal; onText: (text: string) => void },
): Promise<StepReply> {
  const platform: Platform = options.platform === 'win32' || options.platform === 'darwin' ? options.platform : 'linux';
  const project = options.project.replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 60) || 'project';
  const system = options.system ?? agentSystemPrompt(project, platform, options.tools, parseNotes(options.instructions), 'cloud', options.role, options.environment ?? null);
  const reply = await chatWithProvider(
    provider,
    { model: model.apiModel, maxTokens: AGENT_MAX_TOKENS, signal: options.signal, tools: toolDefinitions(options.tools), messages: [{ role: 'system', content: system }, ...messages] },
    partial => options.onText(partial.content),
  );
  return { content: reply.content, toolCalls: reply.toolCalls, finish: reply.finish, charged: 0, balance: null, usage: reply.usage };
}
