import type { ImageAspect } from '../../shared/content';
import { apiFetch } from '../cloud/api';

/** One image from Quo's cloud (server/images.ts): made by an image model through OpenRouter from the prompt alone. */
export interface MadeImage {
  image: string;
  model: { id: string; name: string };
  charged: number;
  balance: number | null;
  freeRemaining: number | null;
}

export async function createImage(ask: { prompt: string; aspect: ImageAspect; edit?: string }, signal?: AbortSignal): Promise<MadeImage> {
  const response = await apiFetch('image', { body: { prompt: ask.prompt, aspect: ask.aspect, ...(ask.edit ? { edit: ask.edit } : {}) }, signal });
  return (await response.json()) as MadeImage;
}
