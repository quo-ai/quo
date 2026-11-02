import type { ThinkChoice } from '../../shared/thinking';
import { listClaudeModels } from './claudeAgent';
import { errorFor } from './errors';
import type { ProviderInfo } from './registry';
import { defaultTransport, type Transport } from './transport';

/** A model a provider offers, as its model list describes it. */
export interface ListedModel {
  id: string;
  name: string;
  contextTokens?: number;
  /** The provider says the model can call tools. Undefined when it doesn't say. */
  tools?: boolean;
  /** The Thinking levels the person can choose for it, and what each means for it, when the provider says (Claude Agent). */
  thinking?: ThinkChoice[];
  thinkingHints?: Partial<Record<ThinkChoice, string>>;
  thinkingDefault?: ThinkChoice | null;
  /** A line about it, and the heading it is listed under, when the provider gives them (Claude Agent). */
  description?: string;
  group?: string;
}

// Models that don't chat: embeddings, speech, images, moderation, and a few retired families.
const NOT_CHAT = /embed|whisper|tts|transcribe|dall-e|image|imagen|veo|moderation|rerank|realtime|audio|davinci|babbage|aqa|guard|vision-preview/i;

interface Entry {
  id?: unknown;
  name?: unknown;
  display_name?: unknown;
  context_length?: unknown;
  supported_parameters?: unknown;
}

/** The chat models a provider offers to this key. */
export async function listProviderModels(provider: ProviderInfo, transport: Transport = defaultTransport()): Promise<ListedModel[]> {
  if (provider.protocol === 'claude-agent') return listClaudeModels();
  const path = provider.protocol === 'anthropic' ? '/models?limit=1000' : '/models';
  const response = await transport.send(provider, { method: 'GET', path });
  const text = await new Response(response.body).text();
  if (!response.ok) throw errorFor(provider, response.status, text);
  let list: Entry[];
  try {
    const json = JSON.parse(text) as { data?: Entry[]; models?: Entry[] };
    list = json.data ?? json.models ?? [];
  } catch {
    return [];
  }
  const seen = new Set<string>();
  const models: ListedModel[] = [];
  for (const entry of Array.isArray(list) ? list : []) {
    if (typeof entry?.id !== 'string') continue;
    const id = entry.id.replace(/^models\//, '');
    if (!id || seen.has(id) || NOT_CHAT.test(id)) continue;
    seen.add(id);
    const name = [entry.display_name, entry.name].find((value): value is string => typeof value === 'string' && value.trim() !== '') ?? id;
    const params = Array.isArray(entry.supported_parameters) ? entry.supported_parameters : null;
    models.push({
      id,
      name: name.trim().replace(/^models\//, ''),
      ...(typeof entry.context_length === 'number' ? { contextTokens: entry.context_length } : {}),
      ...(params ? { tools: params.includes('tools') } : {}),
    });
  }
  return models.sort((a, b) => a.name.localeCompare(b.name));
}
