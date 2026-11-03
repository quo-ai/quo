import type { ImageAspect } from '../../shared/content';
import { NativeError, unwrap } from '../native';
import { downloadState } from '../storage/downloads';
import { DEVICE_IMAGE_MODELS, type ImageModel } from './deviceModels';

/**
 * Images made on this computer (desktop app, apps/desktop/src/images/). Offline chats use them once an image model is
 * downloaded, so nothing leaves the device: not even the prompt. A change to an image is made again from the changed
 * prompt (the model writes it), without sending the picture anywhere.
 */

const bridge = () => (typeof window === 'undefined' ? null : window.quoDesktop?.images ?? null);

/** The image model this computer can use now, or null (browser, no image engine, or none downloaded). */
export function deviceImageModel(): ImageModel | null {
  if (!bridge()) return null;
  return DEVICE_IMAGE_MODELS.find(model => downloadState(model.id)?.status === 'installed') ?? null;
}

/** Whether this computer could make images at all (the desktop app with its image engine). */
export const canMakeImagesOnDevice = (): boolean => bridge() !== null;

export async function makeOnDevice(ask: { prompt: string; aspect: ImageAspect }, signal: AbortSignal, onProgress: (step: number, steps: number) => void = () => {}): Promise<{ image: string; model: string; setAside: boolean }> {
  const images = bridge();
  const model = deviceImageModel();
  if (!images || !model) throw new NativeError('not_installed', 'Download an image model first.');
  const stop = () => void images.cancel();
  signal.addEventListener('abort', stop, { once: true });
  const off = images.onEvent(event => event.type === 'progress' && onProgress(event.step, event.steps));
  try {
    const made = unwrap(await images.make({ modelId: model.id, prompt: ask.prompt, aspect: ask.aspect, steps: model.steps, cfg: model.cfg }));
    return { image: made.image, model: model.name, setAside: made.setAside === true };
  } finally {
    off();
    signal.removeEventListener('abort', stop);
  }
}
