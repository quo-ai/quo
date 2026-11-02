import { cutOf, MAX_CUT_IDS } from '../sync/merge';
import { newId, type Conversation, type Message } from './types';

/**
 * Going back in a chat: to an earlier reply ("go back to here"), or to before an earlier message to send it again,
 * edited. The messages after that point are removed and recorded on the chat (`x.cut`), so Quo Sync doesn't bring them
 * back from another device (sync/merge.ts).
 */
export function cutFrom(conversation: Conversation, from: number, now = Date.now()): { conversation: Conversation; removed: Message[] } {
  const removed = conversation.messages.slice(from);
  if (from < 0 || removed.length === 0) return { conversation, removed: [] };
  const ids = [...new Set([...(cutOf(conversation)?.ids ?? []), ...removed.map(message => message.id)])].slice(-MAX_CUT_IDS);
  return {
    conversation: { ...conversation, messages: conversation.messages.slice(0, from), updatedAt: now, x: { ...conversation.x, cut: { at: now, ids } } },
    removed,
  };
}

/**
 * Undoing "go back": the removed messages return as new messages (new ids). Their old ids stay recorded as removed,
 * so a device that already learned of the removal keeps these instead of dropping them again.
 */
export function restoreCut(cut: Conversation, removed: Message[], now = Date.now(), makeId: () => string = newId): Conversation {
  return { ...cut, updatedAt: now, messages: [...cut.messages, ...removed.map(message => ({ ...message, id: makeId() }))] };
}

/** Whether removed replies changed files in Code mode: those files stay as they are, and the person should hear so. */
export const changedFiles = (removed: Message[]): boolean =>
  removed.some(message => message.steps?.some(step => step.status === 'done' && step.detail?.kind === 'diff'));

/** How many messages come after the one at `index` (what editing it would remove), not counting notes. */
export const laterMessages = (messages: Message[], index: number): number => messages.slice(index + 1).filter(message => !message.summary).length;
