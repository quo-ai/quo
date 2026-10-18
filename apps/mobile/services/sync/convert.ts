import type { Conversation, Message } from '@/types/chat';
import type { WireAttachment, WireChat, WireMemory, WireMessage } from './wire';

/**
 * The phone's chats and memories in and out of the wire format (wire.ts), which
 * the web and desktop apps share. Pure functions, so they're tested on their own
 * and against the web app's.
 *
 *  - The phone keeps a model's thinking inside the message as <think>…</think>;
 *    on the wire it's a separate `reasoning` field, like everywhere else.
 *  - Photos and documents leave only their names; the contents stay on the phone.
 *  - What only the phone understands (full generation stats, tool actions) travels
 *    in `x.mobile`; what other apps add comes back unchanged.
 *  - The rolling summary of a long chat is derived data and never leaves the phone.
 */

const present = <T extends object>(object: T): T => Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined)) as T;
const tidy = (text: string) => text.replace(/<\/?[a-z_]+>/gi, '').replace(/\n{3,}/g, '\n\n').trim();

/**
 * Splits a reply into its thinking and its answer. The same rules as the message
 * bubble's parser (components/message/parseChainOfThought.ts; a test keeps them
 * in step), so what's synced is what's shown.
 */
export function splitThinking(content: string): { thinking: string | null; content: string } {
  const qwen = content.match(/<think>([\s\S]*?)<\/think>/i);
  if (qwen) return { thinking: tidy(qwen[1]), content: content.replace(qwen[0], '').trim() };
  if (/<\/think>/i.test(content)) {
    return { thinking: tidy(content.match(/^([\s\S]*?)<\/think>/i)![1]), content: content.replace(/^[\s\S]*?<\/think>\s*/i, '').trim() };
  }
  const open = content.match(/<think>([\s\S]*)$/i);
  if (open) return { thinking: tidy(open[1]), content: '' };
  const mistral = content.match(/\[THINK\]([\s\S]*?)\[\/THINK\]/i);
  if (mistral) return { thinking: tidy(mistral[1]), content: content.replace(/\[THINK\][\s\S]*?\[\/THINK\]/gi, '').trim() };
  if (/\[\/THINK\]/i.test(content)) {
    return { thinking: tidy(content.match(/^([\s\S]*?)\[\/THINK\]/i)![1]), content: content.replace(/^[\s\S]*?\[\/THINK\]\s*/i, '').trim() };
  }
  const mistralOpen = content.match(/\[THINK\]([\s\S]*)$/i);
  if (mistralOpen) return { thinking: tidy(mistralOpen[1]), content: '' };
  return { thinking: null, content };
}

export function toWireMessage(message: Message): WireMessage {
  const { thinking, content } = message.role === 'assistant' ? splitThinking(message.content) : { thinking: null, content: message.content };
  const attachments: WireAttachment[] = [];
  if (message.image) attachments.push(present({ id: `${message.id}:image`, kind: 'image' as const, name: 'Photo', width: message.image.width, height: message.image.height, omitted: true as const }));
  if (message.document) attachments.push({ id: `${message.id}:document`, kind: 'document', name: message.document.name, omitted: true });

  const mobile = present({ stats: message.stats, toolActions: message.toolActions });
  const x = Object.keys(mobile).length ? { ...message.x, mobile } : message.x;

  return present({
    id: message.id,
    role: message.role,
    content,
    reasoning: thinking || undefined,
    timestamp: message.timestamp,
    stats: message.stats
      ? { tokens: message.stats.completionTokens, tokensPerSecond: message.stats.tokensPerSecond, timeToFirstTokenMs: Math.round(message.stats.promptTime * 1000) }
      : undefined,
    attachments: attachments.length ? attachments : undefined,
    x,
  });
}

/** `wire` as a phone message, keeping everything `local` (this phone's copy of the same message) has that the wire doesn't. */
export function fromWireMessage(wire: WireMessage, local: Message | undefined, fallbackTime: number): Message {
  if (local) {
    const mine = toWireMessage(local);
    if (mine.content === wire.content && mine.reasoning === wire.reasoning) return local;
  }
  const { mobile, ...others } = (wire.x ?? {}) as { mobile?: { stats?: Message['stats']; toolActions?: Message['toolActions'] } } & Record<string, unknown>;
  const content = wire.reasoning ? `<think>${wire.reasoning}</think>\n\n${wire.content}` : wire.content;
  return present({
    ...local,
    id: wire.id,
    role: wire.role,
    content,
    timestamp: wire.timestamp ?? local?.timestamp ?? fallbackTime,
    image: local?.image,
    document: local?.document,
    toolActions: mobile?.toolActions ?? local?.toolActions,
    stats: mobile?.stats ?? local?.stats,
    x: Object.keys(others).length ? others : undefined,
    isStreaming: undefined,
  });
}

export function toWireChat(conversation: Conversation): WireChat {
  return present({
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messages: conversation.messages.map(toWireMessage),
    x: conversation.x,
  });
}

export function fromWireChat(wire: WireChat, local?: Conversation): Conversation {
  const mine = new Map(local?.messages.map(message => [message.id, message]));
  const messages = wire.messages.map(message => fromWireMessage(message, mine.get(message.id), wire.createdAt));
  // The summary stands in for the first N messages; it's only still right if those are unchanged.
  const summary = local?.contextSummary;
  const summaryHolds = summary && messages.length >= summary.coversMessageCount && local!.messages.slice(0, summary.coversMessageCount).every((m, i) => messages[i].id === m.id);
  return present({
    id: wire.id,
    title: wire.title,
    messages,
    createdAt: wire.createdAt,
    updatedAt: wire.updatedAt,
    contextSummary: summaryHolds ? summary : undefined,
    x: wire.x,
  });
}

/** Changes whenever a chat gains a message or is edited; how sync notices a chat moved on while it was working. */
export const chatFingerprint = (conversation: Conversation): string =>
  `${conversation.updatedAt}:${conversation.messages.length}:${conversation.messages.at(-1)?.id ?? ''}`;

interface PhoneMemory {
  id: string;
  content: string;
  createdAt: number;
  updatedAt?: number;
}

export const toWireMemory = (memory: PhoneMemory): WireMemory => ({
  id: memory.id,
  content: memory.content,
  createdAt: memory.createdAt,
  updatedAt: memory.updatedAt ?? memory.createdAt,
});

export const fromWireMemory = (wire: WireMemory): PhoneMemory => ({ id: wire.id, content: wire.content, createdAt: wire.createdAt, updatedAt: wire.updatedAt });
