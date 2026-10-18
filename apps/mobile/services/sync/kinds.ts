import type { KindStore } from './engine';
import { reconcileChat, reconcileMemory } from './merge';
import type { WireChat, WireMemory } from './wire';

/**
 * The kinds of data that sync, as the engine sees them. A platform supplies
 * where the data lives (`Storage`, in wire format); how to check a record and
 * how to merge two versions is the same everywhere, so it's here.
 */

export interface Storage<T> {
  get(id: string): Promise<T | undefined>;
  put(item: T): Promise<void>;
  remove(id: string): Promise<void>;
  all(): Promise<T[]>;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function parseChat(value: unknown, id: string): WireChat | null {
  if (!isObject(value) || value.id !== id || typeof value.title !== 'string' || !isNumber(value.createdAt) || !isNumber(value.updatedAt) || !Array.isArray(value.messages)) return null;
  const messages = value.messages as unknown[];
  const ids = new Set<string>();
  for (const message of messages) {
    if (!isObject(message) || typeof message.id !== 'string' || ids.has(message.id)) return null;
    if ((message.role !== 'user' && message.role !== 'assistant') || typeof message.content !== 'string') return null;
    ids.add(message.id);
  }
  return value as unknown as WireChat;
}

export function parseMemory(value: unknown, id: string): WireMemory | null {
  if (!isObject(value) || value.id !== id || typeof value.content !== 'string' || !value.content.trim() || !isNumber(value.createdAt) || !isNumber(value.updatedAt)) return null;
  return value as unknown as WireMemory;
}

/** Chats keep their own id as the server's id. */
export function chatKind(storage: Storage<WireChat>): KindStore<WireChat> {
  return {
    kind: 'chat',
    recordId: id => id,
    itemId: recordId => recordId,
    ...storage,
    parse: parseChat,
    reconcile: reconcileChat,
  };
}

/** Memories are prefixed (`memory:<id>`) so their ids can never collide with a chat's. */
export function memoryKind(storage: Storage<WireMemory>): KindStore<WireMemory> {
  return {
    kind: 'memory',
    recordId: id => `memory:${id}`,
    itemId: recordId => (recordId.startsWith('memory:') ? recordId.slice('memory:'.length) : null),
    ...storage,
    parse: parseMemory,
    reconcile: (local, remote) => reconcileMemory(local, remote),
  };
}
