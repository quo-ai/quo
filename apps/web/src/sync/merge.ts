import type { WireChat, WireMemory, WireMessage } from './wire';

/**
 * How two versions of the same thing become one. Chats mostly grow at the end,
 * so when both sides changed one, they usually agree on a shared start. When
 * they really diverged, nothing is thrown away: the newer version keeps the chat
 * and the other is kept as a copy.
 */

export interface Reconciled<T> {
  item: T;
  /** The version that lost a real divergence, kept as an item of its own. */
  copy?: T;
  /** The result differs from what the server has, so it needs uploading. */
  pushNeeded: boolean;
}

const isPrefix = (shorter: WireMessage[], longer: WireMessage[]): boolean =>
  shorter.length <= longer.length && shorter.every((message, i) => message.id === longer[i].id);

export function reconcileChat(local: WireChat, remote: WireChat, newId: () => string): Reconciled<WireChat> {
  const sameStart = isPrefix(local.messages, remote.messages);
  const remoteIsStart = isPrefix(remote.messages, local.messages);

  if (sameStart && remoteIsStart) {
    // Same messages; the later edit (say, a stopped reply that was finished) wins.
    const localWins = local.updatedAt > remote.updatedAt;
    return { item: localWins ? local : remote, pushNeeded: localWins };
  }
  if (sameStart) return { item: remote, pushNeeded: false };
  if (remoteIsStart) return { item: local, pushNeeded: true };

  const localWins = local.updatedAt > remote.updatedAt;
  const loser = localWins ? remote : local;
  return {
    item: localWins ? local : remote,
    copy: { ...loser, id: newId(), title: `${loser.title} (other device)` },
    pushNeeded: localWins,
  };
}

/** A memory edited on two devices: the later edit wins (a tie goes to the server's version). */
export function reconcileMemory(local: WireMemory, remote: WireMemory): Reconciled<WireMemory> {
  const localWins = local.updatedAt > remote.updatedAt;
  return { item: localWins ? local : remote, pushNeeded: localWins };
}
