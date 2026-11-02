import { applyUsage } from '../cloud/account';
import { ApiError } from '../cloud/api';
import type { GeneratedImage, Message } from '../chat/types';
import { toast } from '../ui/Toasts';
import { createImage } from './api';

/**
 * Makes the images a reply asked for, one after another, updating the message as each is made or fails. A change to the
 * last image ("edit") sends that image with the prompt: the newest one made before it in this chat.
 */
export async function makeImages(messages: Message[], replyId: string, update: (images: GeneratedImage[]) => void, signal: AbortSignal): Promise<void> {
  const reply = messages.find(message => message.id === replyId);
  let images = [...(reply?.images ?? [])];
  const earlier = messages.slice(0, messages.findIndex(message => message.id === replyId)).flatMap(message => message.images ?? []);
  for (const [index, image] of images.entries()) {
    if (image.status !== 'creating') continue;
    if (signal.aborted) {
      images = images.map((one, i) => (i >= index && one.status === 'creating' ? { ...one, status: 'failed', error: 'Stopped.' } : one));
      update(images);
      return;
    }
    const last = [...earlier, ...images.slice(0, index)].filter(one => one.status === 'done' && one.dataUrl).at(-1);
    try {
      const made = await createImage({ prompt: image.prompt, aspect: image.aspect, ...(image.edit && last?.dataUrl ? { edit: last.dataUrl } : {}) }, signal);
      images = images.map((one, i) => (i === index ? { ...one, status: 'done', dataUrl: made.image, model: made.model.name, charged: made.charged } : one));
      // The balance only: an image's "free left" is the image allowance, not the free messages the account shows.
      if (made.balance !== null) applyUsage({ balance: made.balance, freeRemaining: null });
      if (made.freeRemaining === 0 && !made.charged) {
        toast(made.balance !== null ? 'That was today’s last free image. More use credits, about 2 each, until they come back tomorrow.' : 'That was today’s last free image. They come back tomorrow.');
      }
    } catch (error) {
      const message = signal.aborted ? 'Stopped.' : error instanceof ApiError ? error.message : 'The image couldn’t be made. Try again.';
      images = images.map((one, i) => (i === index ? { ...one, status: 'failed', error: message } : one));
    }
    update(images);
  }
}

/** The prompt of the newest image made in a chat, for a change to it. */
export const lastImagePrompt = (messages: Message[]): string | null =>
  messages.flatMap(message => message.images ?? []).filter(image => image.status === 'done').at(-1)?.prompt ?? null;
