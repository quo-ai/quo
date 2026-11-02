import { textOf, type ChatTurn, type ContentPart } from '../engine/localEngine';
import type { Message } from './types';

/**
 * Fits a conversation into the model's context window: the system prompt
 * and the newest messages are kept, the oldest dropped, leaving room for the
 * reply. Token counts are estimated (~3.5 characters per token, plus a few
 * tokens of chat-template overhead per message), which errs on the safe side
 * for English and code.
 *
 * Attached documents go into the user's message in <document> tags before the
 * question, and attached images become image parts, the same as the phone apps.
 *
 * Old messages are dropped in steps of TRIM_STEP, not one turn at a time: the
 * engines (and providers) reuse the cached start of the prompt, and a start
 * that moved on every turn made a long chat be read again in full each time.
 */

const CHARS_PER_TOKEN = 3.5;
const PER_MESSAGE_OVERHEAD = 6;
const SAFETY_MARGIN = 256;
/** What one attached image costs the context, on average. */
const IMAGE_TOKENS = 800;
/** Messages are dropped from the front in groups this size (an even number keeps a user turn first). */
export const TRIM_STEP = 8;

const DEFAULT_DOCUMENT_PROMPT = 'Please analyse this document.';
const DEFAULT_IMAGE_PROMPT = 'What do you see in this image? Describe it in detail.';

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN) + PER_MESSAGE_OVERHEAD;
}

type ChatMessage = Pick<Message, 'role' | 'content' | 'attachments'>;

const imagesOf = (message: ChatMessage) => message.attachments?.filter(a => a.kind === 'image' && a.dataUrl) ?? [];
const documentsOf = (message: ChatMessage) => message.attachments?.filter(a => a.kind === 'document' && a.text) ?? [];

/**
 * The text of a user turn. `documentChars` caps the attached text (split
 * between documents), for when a message is too long for the context.
 */
export function userText(message: ChatMessage, documentChars = Infinity): string {
  const documents = documentsOf(message);
  const text = message.content.trim();
  if (!documents.length) return text;
  const each = documentChars / documents.length;
  const blocks = documents.map(document => {
    // Quotes and angle brackets in a file name could break out of the attribute.
    const name = document.name.replace(/[<>"]/g, '_');
    const body = document.text!.length > each ? `${document.text!.slice(0, Math.max(0, Math.floor(each)))}\n[The rest of this document was left out to fit.]` : document.text!;
    return `<document filename="${name}">\n${body}\n</document>`;
  });
  return `${blocks.join('\n\n')}\n\n${text || DEFAULT_DOCUMENT_PROMPT}`;
}

function toTurn(message: ChatMessage, documentChars?: number): ChatTurn {
  if (message.role !== 'user') return { role: message.role, content: message.content };
  const images = imagesOf(message);
  const text = userText(message, documentChars);
  if (!images.length) return { role: 'user', content: text };
  return {
    role: 'user',
    content: [
      ...images.map(image => ({ type: 'image_url' as const, image_url: { url: image.dataUrl! } })),
      { type: 'text' as const, text: text || DEFAULT_IMAGE_PROMPT },
    ],
  };
}

const costOf = (turn: ChatTurn) => estimateTokens(textOf(turn.content)) + (Array.isArray(turn.content) ? turn.content.filter(part => part.type === 'image_url').length * IMAGE_TOKENS : 0);

/**
 * `maxImages`: how many images may go with the request, newest first; older ones are left out and a short note says
 * one was there (models in the cloud take a few at a time: shared/content.ts; 0 for a model that can't read images).
 */
export function buildContext(
  systemPrompt: string,
  messages: ChatMessage[],
  contextSize: number,
  maxTokens: number,
  maxImages = Infinity,
): ChatTurn[] {
  let budget = contextSize - maxTokens - SAFETY_MARGIN - estimateTokens(systemPrompt);
  const kept: ChatTurn[] = [];
  const keptAt: number[] = [];
  let trimmed = false;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message.content && !message.attachments?.length) continue;
    let turn = toTurn(message);
    const cost = costOf(turn);
    // Always keep the newest message. If it alone is too long, shorten what
    // can be shortened (attached documents, else the text from the front), so
    // the user's question is never silently dropped.
    if (kept.length === 0 && cost > budget) {
      const room = Math.max(0, budget - PER_MESSAGE_OVERHEAD - imagesOf(message).length * IMAGE_TOKENS);
      if (documentsOf(message).length) {
        const questionChars = message.content.length + 200;
        turn = toTurn(message, Math.max(0, Math.floor(room * CHARS_PER_TOKEN) - questionChars));
      } else {
        const text = textOf(turn.content);
        const shortened = text.slice(-Math.floor(room * CHARS_PER_TOKEN));
        turn = typeof turn.content === 'string'
          ? { role: turn.role, content: shortened }
          : { role: turn.role, content: [...turn.content.filter(part => part.type === 'image_url'), { type: 'text', text: shortened }] };
      }
      kept.unshift(turn);
      keptAt.unshift(i);
      trimmed = i > 0;
      break;
    }
    if (cost > budget) {
      trimmed = true;
      break;
    }
    budget -= cost;
    kept.unshift(turn);
    keptAt.unshift(i);
  }
  // Something had to go: start at the next step boundary, so the same start holds for the next few turns. The newest
  // message always stays.
  if (trimmed && kept.length > 1) {
    const start = Math.ceil(keptAt[0] / TRIM_STEP) * TRIM_STEP;
    while (kept.length > 1 && keptAt[0] < start) {
      kept.shift();
      keptAt.shift();
    }
  }
  // A chat should open with a user turn; drop a leading orphaned reply.
  while (kept.length > 1 && kept[0].role === 'assistant') kept.shift();
  return [{ role: 'system', content: systemPrompt }, ...withImages(kept, maxImages)];
}

const IMAGE_LEFT_OUT = '[An image was attached here; it was left out of this request.]';

/** The turns with at most `limit` images, the newest kept. A turn whose images all go keeps its text and a note. */
function withImages(turns: ChatTurn[], limit: number): ChatTurn[] {
  let room = limit;
  const out: ChatTurn[] = [];
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (typeof turn.content === 'string') {
      out.unshift(turn);
      continue;
    }
    const parts = [...turn.content].reverse().map((part): ContentPart => {
      if (part.type !== 'image_url' || room > 0) {
        if (part.type === 'image_url') room--;
        return part;
      }
      return { type: 'text', text: IMAGE_LEFT_OUT };
    }).reverse();
    out.unshift(parts.some(part => part.type === 'image_url') ? { role: turn.role, content: parts } : { role: turn.role, content: textOf(parts) });
  }
  return out;
}
