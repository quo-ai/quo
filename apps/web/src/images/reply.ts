import type { ReplyStatus } from '../chat/replies';
import { newId, type GeneratedImage, type Message } from '../chat/types';
import type { ModelChoice } from '../models';
import { lastImagePrompt } from './make';
import { imageAsks, withoutImageAsks, type ImageAsk } from './tags';
import { localEngine } from '../engine/localEngine';
import { imageFollowUp, writeImagePrompt } from './writer';

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

/**
 * An offline chat's message right after a reply that made an image ("remove the apple"): its prompt has no image rules, so
 * a side call decides whether the message asks for a picture. True when the reply is that image (or was stopped); false
 * when the chat should answer as usual. `earlier` ends with the person's new message.
 */
export async function replyWithImageFollowUp(choice: ModelChoice, request: string, earlier: Message[], update: Update, setStatus: (status: ReplyStatus) => void): Promise<boolean> {
  const before = earlier.at(-2);
  const last = before?.role === 'assistant' ? before.images?.filter(image => image.status === 'done').at(-1)?.prompt : undefined;
  if (choice.kind !== 'local' || !last) return false;
  if (localEngine.modelId !== choice.model.id) setStatus('loading');
  const { ask, stopped } = await imageFollowUp(choice, request, last);
  setStatus('generating');
  if (stopped) update({ content: '', stopped: true }, true);
  else if (ask) update({ content: '', images: [pending(ask)] }, true);
  return stopped || Boolean(ask);
}

/** Whether a reply still has images to make. */
export const hasImagesToMake = (message: Message | undefined): boolean => Boolean(message?.images?.some(image => image.status === 'creating'));
