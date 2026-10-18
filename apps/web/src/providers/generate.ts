import { textOf, type ChatTurn, type GenerationUpdate } from '../engine/localEngine';
import { chatWithProvider } from './chat';
import type { OwnModel } from './ownModels';
import type { ProviderInfo } from './registry';

/** A reply from a model reached with the user's own key. Like the cloud engine: the text so far goes through onUpdate. */

export interface OwnResult {
  content: string;
  reasoning: string;
  stopped: boolean;
  usage: { input: number; output: number } | null;
}

const CHAT_MAX_TOKENS = 4096;
let current: AbortController | null = null;

export function stopOwn(): void {
  current?.abort();
}

/** `web`: let the provider search the web for this reply (OpenRouter's web plugin, Anthropic's search tool). */
export async function generateOwn(provider: ProviderInfo, model: OwnModel, messages: ChatTurn[], onUpdate: (update: GenerationUpdate) => void, options: { web?: boolean } = {}): Promise<OwnResult> {
  current?.abort();
  const controller = new AbortController();
  current = controller;
  const result: OwnResult = { content: '', reasoning: '', stopped: false, usage: null };
  try {
    const reply = await chatWithProvider(
      provider,
      {
        model: model.apiModel,
        maxTokens: CHAT_MAX_TOKENS,
        signal: controller.signal,
        ...(options.web && provider.id === 'anthropic' ? { webSearch: true } : {}),
        ...(options.web && provider.id === 'openrouter' ? { extra: { plugins: [{ id: 'web', max_results: 5 }] } } : {}),
        messages: messages.map(turn => ({ role: turn.role, content: textOf(turn.content) })) },
      partial => {
        result.content = partial.content;
        result.reasoning = partial.reasoning;
        onUpdate({ content: partial.content, reasoning: partial.reasoning });
      },
    );
    Object.assign(result, { content: reply.content, reasoning: reply.reasoning, usage: reply.usage });
  } catch (error) {
    if (controller.signal.aborted) result.stopped = true;
    else throw error;
  } finally {
    if (current === controller) current = null;
  }
  return result;
}
