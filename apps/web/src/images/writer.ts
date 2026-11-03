import { IMAGE_FOLLOW_UP_PROMPT, IMAGE_WRITER_PROMPT } from '../../shared/prompts';
import { generateCloud } from '../cloud/cloudEngine';
import { applyUsage } from '../cloud/account';
import { localEngine, type ChatTurn } from '../engine/localEngine';
import type { ModelChoice } from '../models';
import { generateOwn } from '../providers/generate';
import { imageAsks, type ImageAsk } from './tags';

/**
 * The image prompt, written by the chat's own model in a side call, for chats whose prompt has no image rules: offline
 * models (small ones follow a short, single task best, and only this prompt leaves the computer) and Code mode.
 * `request` is what the person asked; `last` is the prompt of the last image made in the chat, for a change to it.
 */
export async function writeImagePrompt(choice: ModelChoice, request: string, last: string | null, options: { contextSize?: number } = {}): Promise<ImageAsk> {
  const asked = [last ? `The last image was made from this prompt: ${last}` : '', `The user asks: ${request}`].filter(Boolean).join('\n\n');
  const turns: ChatTurn[] = [{ role: 'system', content: IMAGE_WRITER_PROMPT }, { role: 'user', content: asked }];
  const ignore = () => {};
  let text = '';
  try {
    if (choice.kind === 'own') text = (await generateOwn(choice.provider, choice.model, turns, ignore, { oneOff: true })).content;
    else if (choice.kind === 'cloud') {
      const result = await generateCloud(choice.model.id, turns, { thinking: false, onUpdate: ignore });
      applyUsage(result);
      text = result.content;
    } else text = (await localEngine.generate(choice.model, turns, { thinking: false, onUpdate: ignore, contextSize: options.contextSize })).content;
  } catch {
    // The person's own words make a fair prompt too.
  }
  const ask = imageAsks(text)[0];
  if (ask) return ask;
  // A model that answered without the line: its words, if they look like a prompt, else the person's.
  const words = text.replace(/<\/?[a-z][^>]*>/gi, ' ').replace(/\s+/g, ' ').trim();
  return { prompt: (words.length >= 12 ? words : request).slice(0, 4000), aspect: '1:1', edit: Boolean(last) && /\b(change|make it|edit|instead|same|again|more|less|turn it)\b/i.test(request) };
}

/**
 * The message right after a reply that made an image, in an offline model's chat: whether it asks for a picture (a new one,
 * or a change to that one, whose prompt is `last`), decided by the model in a short side call. `ask` is null when it is
 * about something else, and the chat answers as usual; `stopped` when the person pressed Stop.
 */
export async function imageFollowUp(choice: Extract<ModelChoice, { kind: 'local' }>, request: string, last: string): Promise<{ ask: ImageAsk | null; stopped: boolean }> {
  const turns: ChatTurn[] = [{ role: 'system', content: IMAGE_FOLLOW_UP_PROMPT }, { role: 'user', content: `The last image was made from this prompt: ${last}\n\nThe user asks: ${request}` }];
  try {
    const result = await localEngine.generate(choice.model, turns, { thinking: false, onUpdate: () => {} });
    return { ask: result.stopped ? null : imageAsks(result.content)[0] ?? null, stopped: result.stopped };
  } catch {
    return { ask: null, stopped: false }; // the ordinary reply says what went wrong
  }
}
