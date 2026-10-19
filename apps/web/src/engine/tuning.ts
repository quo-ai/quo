import type { LocalModel, Sampling } from '../catalog';

/**
 * How an offline model is run, chosen from what the model's makers recommend and what this computer can hold.
 *
 *  - Sampling follows each family's own guidance (the catalog says which set); a photo in the message uses the family's
 *    vision set where it has one.
 *  - Context size is what the model is tuned for, held back when the computer is short of memory: the cost of the
 *    window is real (each token of it takes `kvBytesPerToken` bytes of memory), so a small computer gets a smaller window
 *    for a model that is heavy on it, and a big one gets the full window.
 *  - A model that thinks spends its output budget on the thinking first, so it is given room for both.
 */

/** The share of memory the window (the "KV cache") may take, on top of the model itself. */
export const KV_SHARE = 0.12;
/** Below this a chat stops working: there is no room for the question and the answer. */
export const MIN_CONTEXT = 8192;
/** Thinking replies may run this long, at most (and never more than half the window). */
export const THINKING_TOKENS = 16384;

/** The window to load: the one asked for, or less if the computer cannot hold it. `memoryGB` is the memory the model runs in (graphics memory if it has some, else RAM); null when unknown. */
export function contextFor(model: Pick<LocalModel, 'kvBytesPerToken'>, requested: number, memoryGB: number | null): number {
  if (!model.kvBytesPerToken || !memoryGB || memoryGB <= 0) return requested;
  const fits = Math.floor((memoryGB * 2 ** 30 * KV_SHARE) / model.kvBytesPerToken / 1024) * 1024;
  return Math.min(requested, Math.max(fits, MIN_CONTEXT));
}

/** How many tokens a reply may use: the model's usual, or room for its thinking as well. */
export function maxTokensFor(model: Pick<LocalModel, 'maxTokens'>, thinking: boolean, context: number): number {
  return thinking ? Math.max(model.maxTokens, Math.min(THINKING_TOKENS, Math.floor(context / 2))) : model.maxTokens;
}

/** The sampling for one reply. */
export function samplingFor(model: Pick<LocalModel, 'sampling' | 'thinkingSampling' | 'visionSampling'>, { thinking, images }: { thinking: boolean; images: boolean }): Sampling {
  const base = images && model.visionSampling ? { ...model.sampling, ...model.visionSampling } : model.sampling;
  return { ...base, ...(thinking ? model.thinkingSampling : undefined) };
}

/** Whether any message carries a picture. */
export const hasImages = (messages: { content: string | { type: string }[] }[]): boolean => messages.some(message => Array.isArray(message.content) && message.content.some(part => part.type === 'image_url'));
