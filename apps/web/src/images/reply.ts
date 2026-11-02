import { newId, type GeneratedImage, type Message } from '../chat/types';
import type { ModelChoice } from '../models';
import { lastImagePrompt } from './make';
import { imageAsks, withoutImageAsks, type ImageAsk } from './tags';
import { writeImagePrompt } from './writer';

type Update = (patch: Partial<Message>, persist: boolean) => void;

const pending = (ask: ImageAsk): GeneratedImage => ({ id: newId(), prompt: ask.prompt, aspect: ask.aspect, ...(ask.edit ? { edit: true } : {}), status: 'creating' });

/**
 * A reply's updates with the image lines taken out of what is shown. Once the reply is final, the images it asked for
 * are added to it as being made (src/images/make.ts makes them).
 */
export function showingImages(update: Update): Update {
  return (patch, persist) => {
    if (typeof patch.content !== 'string') return update(patch, persist);
    const asks = persist ? imageAsks(patch.content) : [];
    update({ ...patch, content: withoutImageAsks(patch.content), ...(asks.length ? { images: asks.map(pending) } : {}) }, persist);
  };
}

/**
 * "/image …" with a model whose chat has no image rules (an offline model, or Code mode): the model writes the prompt
 * in a side call, and the reply is the image being made.
 */
export async function replyWithImage(choice: ModelChoice, request: string, earlier: Message[], update: Update, options: { contextSize?: number } = {}): Promise<void> {
  const ask = await writeImagePrompt(choice, request, lastImagePrompt(earlier), options);
  update({ content: '', images: [pending(ask)] }, true);
}

/** Whether a reply still has images to make. */
export const hasImagesToMake = (message: Message | undefined): boolean => Boolean(message?.images?.some(image => image.status === 'creating'));
