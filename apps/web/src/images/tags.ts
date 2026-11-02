import { IMAGE_ASPECTS, type ImageAspect } from '../../shared/content';
import type { Message } from '../chat/types';

/**
 * How a model asks for an image: a line `<image aspect="16:9" edit="last">prompt</image>` in its reply (shared/prompts.ts
 * tells it so). The app takes those lines out of what the person sees, makes each image (make.ts) and shows it under
 * the reply. Later turns tell the model what it made (modelText), so it can change the last image.
 */

export interface ImageAsk {
  prompt: string;
  aspect: ImageAspect;
  /** Change the last image made, instead of making a new one. */
  edit: boolean;
}

const TAG = /<image\b([^>]*)>([\s\S]*?)<\/image>/gi;
/** Images one reply may ask for. */
export const MAX_IMAGES_PER_REPLY = 2;

const attribute = (attributes: string, name: string): string | null => new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(attributes)?.[1] ?? null;

/** The images a reply asks for, in order. */
export function imageAsks(text: string): ImageAsk[] {
  const asks: ImageAsk[] = [];
  for (const [, attributes, body] of text.matchAll(TAG)) {
    const prompt = body.replace(/\s+/g, ' ').trim().slice(0, 4000);
    if (!prompt) continue;
    const aspect = attribute(attributes, 'aspect');
    asks.push({ prompt, aspect: IMAGE_ASPECTS.includes(aspect as ImageAspect) ? (aspect as ImageAspect) : '1:1', edit: attribute(attributes, 'edit') === 'last' });
    if (asks.length === MAX_IMAGES_PER_REPLY) break;
  }
  return asks;
}

/** A reply as the person sees it: without the image lines, nor the start of one that is still arriving. */
export function withoutImageAsks(text: string): string {
  const shown = text.replace(TAG, '').replace(/<image\b[\s\S]*$/i, '').replace(/<(i(m(a(g(e)?)?)?)?)?$/i, '');
  return shown.replace(/\n{3,}/g, '\n\n').trim();
}

/** What a model is told a message said: its words, and for a reply the images it made (by their prompts). */
export function modelText(message: Pick<Message, 'role' | 'content' | 'images'>): string {
  const made = message.role === 'assistant' ? (message.images ?? []).filter(image => image.status === 'done') : [];
  if (!made.length) return message.content;
  return [message.content, ...made.map(image => `[Image made: ${image.prompt}]`)].filter(Boolean).join('\n');
}

/** "/image a fox in the snow" asks for an image outright; the rest of the message is what to draw. */
export const IMAGE_COMMAND = /^\/(image|img|draw)\s+([\s\S]+)$/i;
export const asImageAsk = (text: string): string | null => {
  const match = IMAGE_COMMAND.exec(text.trim());
  return match ? `Make an image: ${match[2].trim()}` : null;
};
