import type { Attachment, Conversation, Message } from '../chat/types';

/**
 * Chats are append-mostly, so two devices that both changed a chat usually
 * agree on a shared start and differ only at the end. When they really
 * diverged, nothing is thrown away: the newer version wins the chat and the
 * other is kept as a copy.
 */

/**
 * The version of a chat that is uploaded. Attached images and documents can be
 * large, so their contents stay on the device they were added on; other
 * devices see the file name and a note.
 */
export function prepareForSync(conversation: Conversation): Conversation {
  return {
    ...conversation,
    messages: conversation.messages.map(message => {
      if (!message.attachments?.length) return message;
      const attachments: Attachment[] = message.attachments.map(({ id, kind, name, width, height }) => ({ id, kind, name, width, height, omitted: true }));
      return { ...message, attachments };
    }),
  };
}

const isPrefix = (shorter: Message[], longer: Message[]): boolean =>
  shorter.length <= longer.length && shorter.every((message, i) => message.id === longer[i].id);

/** `incoming` with this device's own attachment contents put back (the upload leaves them out). */
export function withLocalAttachments(incoming: Conversation, local: Conversation): Conversation {
  const mine = new Map(local.messages.filter(m => m.attachments?.some(a => !a.omitted)).map(m => [m.id, m.attachments!]));
  if (mine.size === 0) return incoming;
  return { ...incoming, messages: incoming.messages.map(m => (mine.has(m.id) && m.attachments?.some(a => a.omitted) ? { ...m, attachments: mine.get(m.id) } : m)) };
}

export interface Reconciled {
  conversation: Conversation;
  /** The version that lost a real divergence, kept as its own chat. */
  copy?: Conversation;
  /** The result differs from what the server has. */
  pushNeeded: boolean;
}

export function reconcile(local: Conversation, remote: Conversation, newId: () => string): Reconciled {
  const sameStart = isPrefix(local.messages, remote.messages);
  const remoteIsStart = isPrefix(remote.messages, local.messages);

  if (sameStart && remoteIsStart) {
    // Same messages; the later edit (say, a stopped reply that was finished) wins.
    const localWins = local.updatedAt > remote.updatedAt;
    return { conversation: localWins ? local : withLocalAttachments(remote, local), pushNeeded: localWins };
  }
  if (sameStart) return { conversation: withLocalAttachments(remote, local), pushNeeded: false };
  if (remoteIsStart) return { conversation: local, pushNeeded: true };

  const localWins = local.updatedAt > remote.updatedAt;
  const loser = localWins ? withLocalAttachments(remote, local) : local;
  return {
    conversation: localWins ? local : withLocalAttachments(remote, local),
    copy: { ...loser, id: newId(), title: `${loser.title} (other device)` },
    pushNeeded: localWins,
  };
}
