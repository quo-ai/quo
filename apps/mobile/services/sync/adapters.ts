import { markSyncApplied } from '@/services/storage';
import { memoryService } from '@/services/memory';
import { getChatBridge } from './bridge';
import { chatFingerprint, fromWireChat, fromWireMemory, toWireChat, toWireMemory } from './convert';
import type { Storage } from './kinds';
import type { WireChat, WireMemory } from './wire';

/**
 * The phone's chats and memories as the sync engine sees them (wire format).
 */

/** A chat changed on this phone while sync was working on it: stop, and try again in a moment. */
export class ConcurrentEditError extends Error {}

export class NotReadyError extends Error {}

const bridge = () => {
  const current = getChatBridge();
  if (!current) throw new NotReadyError('chats not loaded');
  return current;
};

// What each chat looked like when sync last read it, so a write can tell whether it moved on since.
const seen = new Map<string, string | null>();

export const chatStorage: Storage<WireChat> = {
  async get(id) {
    const local = bridge().getAll().find(conversation => conversation.id === id);
    seen.set(id, local ? chatFingerprint(local) : null);
    return local && toWireChat(local);
  },

  async put(wire) {
    const chats = bridge();
    const local = chats.getAll().find(conversation => conversation.id === wire.id);
    const expected = seen.has(wire.id) ? seen.get(wire.id)! : local ? chatFingerprint(local) : null;
    const next = fromWireChat(wire, local);
    if (!chats.apply(next, expected)) throw new ConcurrentEditError(wire.id);
    markSyncApplied(next); // when it's saved, that's not the user editing it
    seen.set(wire.id, chatFingerprint(next));
  },

  async remove(id) {
    if (!bridge().remove(id, seen.has(id) ? seen.get(id)! : null)) throw new ConcurrentEditError(id);
    seen.delete(id);
  },

  async all() {
    return bridge().getAll().map(toWireChat);
  },
};

export const memoryStorage: Storage<WireMemory> = {
  async get(id) {
    await memoryService.initialize();
    const memory = memoryService.snapshot().find(item => item.id === id);
    return memory && toWireMemory(memory);
  },
  put: wire => memoryService.putFromSync(fromWireMemory(wire)),
  remove: id => memoryService.removeFromSync(id),
  async all() {
    await memoryService.initialize();
    return memoryService.snapshot().map(toWireMemory);
  },
};
