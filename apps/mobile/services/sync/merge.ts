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

/**
 * Messages someone removed on purpose (going back to an earlier reply, or editing an earlier message), recorded on the
 * chat in `x.cut` by the app that removed them: their ids, and when. Both versions lose those messages before they are
 * compared, so a device that still has them doesn't bring them back, while messages a device added that the other never
 * saw are kept (a real divergence still keeps both). The record travels with the chat, joined from both sides.
 */
export interface ChatCut {
  at: number;
  ids: string[];
}
export const MAX_CUT_IDS = 1000;

export function cutOf(chat: { x?: Record<string, unknown> }): ChatCut | null {
  const cut = chat.x?.cut as { at?: unknown; ids?: unknown } | undefined;
  if (!cut || typeof cut.at !== 'number' || !Array.isArray(cut.ids)) return null;
  return { at: cut.at, ids: cut.ids.filter((id): id is string => typeof id === 'string') };
}

const joinCuts = (a: ChatCut | null, b: ChatCut | null): ChatCut | null =>
  !a ? b : !b ? a : { at: Math.max(a.at, b.at), ids: [...new Set([...a.ids, ...b.ids])].slice(-MAX_CUT_IDS) };

const applyCut = (chat: WireChat, cut: ChatCut): WireChat => {
  const gone = new Set(cut.ids);
  return { ...chat, messages: chat.messages.filter(message => !gone.has(message.id)), x: { ...chat.x, cut } };
};

const shape = (chat: WireChat) => `${chat.messages.map(message => message.id).join()}|${JSON.stringify(cutOf(chat))}`;

export function reconcileChat(local: WireChat, remote: WireChat, newId: () => string): Reconciled<WireChat> {
  const cut = joinCuts(cutOf(local), cutOf(remote));
  if (!cut) return reconcileGrowing(local, remote, newId);
  const result = reconcileGrowing(applyCut(local, cut), applyCut(remote, cut), newId);
  // The server's copy must lose the removed messages too, and learn of the removal.
  return { ...result, pushNeeded: result.pushNeeded || shape(result.item) !== shape(remote) };
}

/** Chats mostly grow at the end: when one version is the start of the other, the longer one is the chat. */
function reconcileGrowing(local: WireChat, remote: WireChat, newId: () => string): Reconciled<WireChat> {
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
