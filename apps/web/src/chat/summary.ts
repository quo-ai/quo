import { applyUsage } from '../cloud/account';
import { generateCloud } from '../cloud/cloudEngine';
import { localEngine, type ChatTurn } from '../engine/localEngine';
import type { ModelChoice } from '../models';
import { generateOwn } from '../providers/generate';
import type { Message } from './types';

/**
 * When a conversation's memory fills, the model writes notes on it and the conversation goes on from those notes. The
 * messages stay on screen and in the saved chat; only what the model is sent changes: the notes, and what came after.
 */

const PROMPT = [
  'You write notes so an AI assistant can carry on a conversation after its memory is cleared.',
  'Write under 300 words, in plain text with short lines and no preamble: what the user wants, what has been done (files read or changed, commands run, pages read), the facts and decisions that matter, and what is left to do.',
].join(' ');

const TRANSCRIPT_CHARS = 30_000;

/** What the model is sent for the conversation: from the latest notes on, with the notes put in front of the first message after them. */
export function modelMessages<T extends Pick<Message, 'role' | 'content' | 'summary'>>(messages: T[]): T[] {
  const at = messages.map(m => Boolean(m.summary)).lastIndexOf(true);
  if (at < 0) return messages;
  const notes = `Notes on our conversation so far, from my earlier messages:\n${messages[at].content}`;
  const rest = messages.slice(at + 1);
  const first = rest.findIndex(m => m.role === 'user');
  if (first < 0) return rest;
  return rest.map((m, i) => (i === first ? { ...m, content: `${notes}\n\n---\n\n${m.content}` } : m));
}

/** The conversation as plain text for the model to summarise, newest kept if it is long. */
export function transcript(messages: Pick<Message, 'role' | 'content' | 'steps'>[]): string {
  const lines = messages.filter(m => m.content || m.steps?.length).map(m => {
    const did = m.steps?.length ? `\n(${m.steps.map(step => step.title.replace(/…$/, '')).slice(0, 25).join('; ')})` : '';
    return `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, 3000)}${did}`;
  });
  let text = lines.join('\n\n');
  if (text.length > TRANSCRIPT_CHARS) text = `[The start is left out.]\n${text.slice(-TRANSCRIPT_CHARS)}`;
  return text;
}

/** Asks the model the chat is using for the notes. `contextSize` keeps an offline model at the window it has for Code mode. */
export async function summarize(choice: ModelChoice, messages: Message[], options: { contextSize?: number } = {}): Promise<string> {
  const turns: ChatTurn[] = [{ role: 'system', content: PROMPT }, { role: 'user', content: transcript(modelMessages(messages)) }];
  const ignore = () => {};
  let text = '';
  if (choice.kind === 'own') text = (await generateOwn(choice.provider, choice.model, turns, ignore)).content;
  else if (choice.kind === 'cloud') {
    const result = await generateCloud(choice.model.id, turns, { thinking: false, onUpdate: ignore });
    applyUsage(result);
    text = result.content;
  } else text = (await localEngine.generate(choice.model, turns, { thinking: false, onUpdate: ignore, contextSize: options.contextSize })).content;
  text = text.trim();
  if (text.length < 20) throw new Error('The model didn’t write any notes. Try again.');
  return text;
}
