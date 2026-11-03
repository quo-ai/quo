import { applyUsage } from '../cloud/account';
import { ApiError } from '../cloud/api';
import { NativeError } from '../native';
import type { GeneratedImage, Message } from '../chat/types';
import { toast } from '../ui/Toasts';
import { createImage } from './api';
import { deviceImageModel, makeOnDevice } from './device';
import { imagePlace } from './place';
import { imagePrefs } from './prefs';

/** Shown when an offline chat would send a picture's description to the cloud: the card asks first (GeneratedImages). */
export const ASK_FOR_CLOUD = 'This chat runs offline. Make the picture in the cloud (only its description is sent), or get the image model to make it on this computer.';

/**
 * Makes the images a reply asked for, one after another, updating the message as each is made or fails. A change to the
 * last image ("edit") sends that image with the prompt: the newest one made before it in this chat. Where each is
 * made follows images/place.ts: on this computer for an offline chat with an image model (nothing is sent, and a change
 * is made again from its prompt), in the cloud otherwise, and never from an offline chat to the cloud without asking.
 */
export async function makeImages(messages: Message[], replyId: string, update: (images: GeneratedImage[]) => void, signal: AbortSignal, options: { chat?: 'local' | 'cloud' | 'own' } = {}): Promise<void> {
  const deviceReady = deviceImageModel() !== null;
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
    const place = imagePlace(options.chat ?? 'cloud', { deviceReady, prefs: imagePrefs(), want: image.want });
    if (place === 'ask') {
      images = images.map((one, i) => (i === index ? { ...one, status: 'failed', error: ASK_FOR_CLOUD, choose: true } : one));
      update(images);
      continue;
    }
    try {
      if (place === 'device') {
        const shown = (step: number, steps: number) => {
          images = images.map((one, i) => (i === index ? { ...one, progress: { step, steps } } : one));
          update(images);
        };
        const made = await makeOnDevice({ prompt: image.prompt, aspect: image.aspect }, signal, shown);
        const note = made.setAside ? 'The chat model was set aside to make room. It loads again with your next message.' : undefined;
        images = images.map((one, i) => (i === index ? { ...one, status: 'done', dataUrl: made.image, model: made.model, charged: 0, where: 'device', progress: undefined, ...(note ? { note } : {}) } : one));
        update(images);
        continue;
      }
      const made = await createImage({ prompt: image.prompt, aspect: image.aspect, ...(image.edit && last?.dataUrl ? { edit: last.dataUrl } : {}) }, signal);
      images = images.map((one, i) => (i === index ? { ...one, status: 'done', dataUrl: made.image, model: made.model.name, charged: made.charged, where: 'cloud' } : one));
      // The balance only: an image's "free left" is the image allowance, not the free messages the account shows.
      if (made.balance !== null) applyUsage({ balance: made.balance, freeRemaining: null });
      if (made.freeRemaining === 0 && !made.charged) {
        toast(made.balance !== null ? 'That was today’s last free image. More use credits, about 2 each, until they come back tomorrow.' : 'That was today’s last free image. They come back tomorrow.');
      }
    } catch (error) {
      const message = signal.aborted ? 'Stopped.' : error instanceof ApiError || error instanceof NativeError ? error.message : 'The image couldn’t be made. Try again.';
      images = images.map((one, i) => (i === index ? { ...one, status: 'failed', error: message, progress: undefined, where: place } : one));
    }
    update(images);
  }
}

/** The prompt of the newest image made in a chat, for a change to it. */
export const lastImagePrompt = (messages: Message[]): string | null =>
  messages.flatMap(message => message.images ?? []).filter(image => image.status === 'done').at(-1)?.prompt ?? null;
