import { quoDb } from '../db';

/**
 * Memories: short facts the user wants Quo to know about them ("I'm vegetarian",
 * "my name is Sam"). They live in IndexedDB on this device, sync through Quo
 * Sync if it's on (the phone app keeps the same list), and offline models read
 * them before they reply (memoryPrompt). They are never sent to a cloud model.
 */

/** Same shape as a synced memory (sync/wire.ts), so it goes up and comes down as is. */
export interface Memory {
  id: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

/** The phone app's limit too. Memories that arrive through sync aren't held to either limit. */
export const MAX_MEMORIES = 100;
export const MAX_MEMORY_CHARS = 500;

export class MemoryError extends Error {
  constructor(public code: 'empty' | 'too_long' | 'full' | 'missing') {
    super(code);
  }
}

export const MEMORY_ERRORS: Record<MemoryError['code'], string> = {
  empty: 'Write something for Quo to remember.',
  too_long: `Keep it under ${MAX_MEMORY_CHARS} characters.`,
  full: `That’s ${MAX_MEMORIES} memories, the most Quo keeps. Delete one to add another.`,
  missing: 'That memory is already gone.',
};

const tidy = (text: string) => text.replace(/\s+/g, ' ').trim();

/** Newest first. */
export async function listMemories(): Promise<Memory[]> {
  return (await (await quoDb()).getAllFromIndex('memories', 'createdAt')).reverse();
}

export async function getMemory(id: string): Promise<Memory | undefined> {
  return (await quoDb()).get('memories', id);
}

type EditListener = (id: string, deleted: boolean) => void;
const editListeners = new Set<EditListener>();
const viewListeners = new Set<() => void>();

/** Told when the user adds, edits or deletes a memory on this device (Quo Sync listens). Not for what sync itself writes. */
export function onMemoryChange(listener: EditListener): () => void {
  editListeners.add(listener);
  return () => editListeners.delete(listener);
}

/** Told whenever the list changes for any reason, sync included (the memories screen listens). */
export function onMemoriesChanged(listener: () => void): () => void {
  viewListeners.add(listener);
  return () => viewListeners.delete(listener);
}

const announce = (id: string, deleted: boolean) => {
  editListeners.forEach(listener => listener(id, deleted));
  viewListeners.forEach(listener => listener());
};

export async function addMemory(content: string): Promise<Memory> {
  const text = tidy(content);
  if (!text) throw new MemoryError('empty');
  if (text.length > MAX_MEMORY_CHARS) throw new MemoryError('too_long');
  const all = await listMemories();
  const same = all.find(memory => memory.content.toLowerCase() === text.toLowerCase());
  if (same) return same;
  if (all.length >= MAX_MEMORIES) throw new MemoryError('full');
  const now = Date.now();
  // The same id format as the phone app's, so ids never clash across devices.
  const memory: Memory = { id: `mem_${now}_${Math.random().toString(36).slice(2, 8)}`, content: text, createdAt: now, updatedAt: now };
  await (await quoDb()).put('memories', memory);
  announce(memory.id, false);
  return memory;
}

export async function updateMemory(id: string, content: string): Promise<Memory> {
  const text = tidy(content);
  if (!text) throw new MemoryError('empty');
  if (text.length > MAX_MEMORY_CHARS) throw new MemoryError('too_long');
  const db = await quoDb();
  const existing = await db.get('memories', id);
  if (!existing) throw new MemoryError('missing');
  if (existing.content === text) return existing;
  const memory = { ...existing, content: text, updatedAt: Math.max(Date.now(), existing.updatedAt + 1) };
  await db.put('memories', memory);
  announce(id, false);
  return memory;
}

export async function deleteMemory(id: string): Promise<void> {
  await (await quoDb()).delete('memories', id);
  announce(id, true);
}

export async function clearMemories(): Promise<void> {
  const all = await listMemories();
  await (await quoDb()).clear('memories');
  all.forEach(memory => announce(memory.id, true));
}

/** For Quo Sync: write what came from another device, without counting it as an edit made here. */
export async function putMemoryFromSync(memory: Memory): Promise<void> {
  await (await quoDb()).put('memories', memory);
  viewListeners.forEach(listener => listener());
}

export async function removeMemoryFromSync(id: string): Promise<void> {
  await (await quoDb()).delete('memories', id);
  viewListeners.forEach(listener => listener());
}

/**
 * The memories as a block to add to an offline model's instructions, newest
 * first, as many as fit in `maxChars` (so a long list can't crowd out the chat).
 * Empty when there are none.
 */
export function memoryPrompt(memories: readonly Memory[], maxChars = 1500): string {
  const lines: string[] = [];
  let used = 0;
  for (const memory of [...memories].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const line = `- ${tidy(memory.content)}`;
    if (used + line.length + 1 > maxChars) break;
    lines.push(line);
    used += line.length + 1;
  }
  if (!lines.length) return '';
  return `\n\nThe user has asked you to remember these things about them. Use them when they help, and don’t mention this list unless asked:\n${lines.join('\n')}`;
}
