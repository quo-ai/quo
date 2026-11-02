import { textOf, type ChatTurn, type GenerationUpdate } from '../engine/localEngine';
import { chatWithProvider } from './chat';
import type { OwnModel } from './ownModels';
import type { ProviderInfo } from './registry';
import type { ThinkChoice } from '../../shared/thinking';
import type { WebSource } from '../../shared/webSources';

/** A reply from a model reached with the user's own key. Like the cloud engine: the text so far goes through onUpdate. */

export interface OwnResult {
  content: string;
  reasoning: string;
  stopped: boolean;
  usage: { input: number; output: number } | null;
  /** Pages the provider's own search drew on. */
  sources: WebSource[];
  /** The exact model that answered, when the provider said. */
  model?: string;
}

const CHAT_MAX_TOKENS = 4096;
let current: AbortController | null = null;

export function stopOwn(): void {
  current?.abort();
}

/**
 * `web`: offer the model the provider's own search tool (OpenRouter's, Anthropic's); the model decides whether to search.
 * `thinking`: the person's choice, for a model that takes one. `oneOff`: a side call, such as notes on the chat.
 */
export async function generateOwn(provider: ProviderInfo, model: OwnModel, messages: ChatTurn[], onUpdate: (update: GenerationUpdate & { searches?: string[] }) => void, options: { web?: boolean; thinking?: ThinkChoice; oneOff?: boolean } = {}): Promise<OwnResult> {
  current?.abort();
  const controller = new AbortController();
  current = controller;
  const result: OwnResult = { content: '', reasoning: '', stopped: false, usage: null, sources: [] };
  try {
    const reply = await chatWithProvider(
      provider,
      {
        model: model.apiModel,
        maxTokens: CHAT_MAX_TOKENS,
        signal: controller.signal,
        ...(options.web && provider.id === 'anthropic' ? { webSearch: true } : {}),
        ...(options.web && provider.id === 'openrouter' ? { serverTools: [{ type: 'openrouter:web_search', parameters: { max_results: 5, max_uses: 3 } }] } : {}),
        ...(options.thinking && model.thinking?.includes(options.thinking) ? { effort: options.thinking } : {}),
        ...(options.oneOff ? { oneOff: true } : {}),
        // A user turn keeps its images (src/chat/context.ts already chose which go); the other turns are text.
        messages: messages.map(turn => (turn.role === 'user' ? { role: 'user', content: turn.content } : { role: turn.role, content: textOf(turn.content) })) },
      partial => {
        result.content = partial.content;
        result.reasoning = partial.reasoning;
        onUpdate({ content: partial.content, reasoning: partial.reasoning, ...(partial.searches ? { searches: partial.searches } : {}) });
      },
    );
    Object.assign(result, { content: reply.content, reasoning: reply.reasoning, usage: reply.usage, sources: reply.sources ?? [], ...(reply.model ? { model: reply.model } : {}) });
  } catch (error) {
    if (controller.signal.aborted) result.stopped = true;
    else throw error;
  } finally {
    if (current === controller) current = null;
  }
  return result;
}
