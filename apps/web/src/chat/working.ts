import type { Message } from './types';

/**
 * What to say while a reply is on its way and nothing else on screen says what is happening: before the first word, and
 * between a tool's result and the next step. A running step already names itself ("Reading src/app.ts…"), so this only
 * covers the gaps.
 */
export function workingLabel(message: Pick<Message, 'steps' | 'reasoning' | 'content'> | undefined): string {
  if (!message) return 'Thinking';
  if (message.steps?.some(step => step.status === 'running')) return '';
  if (message.content) return '';
  if (message.reasoning) return 'Thinking';
  return message.steps?.length ? 'Working out the next step' : 'Thinking';
}
