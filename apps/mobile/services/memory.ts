import AsyncStorage from '@react-native-async-storage/async-storage';
import { FREE_TIER_LIMITS, PREMIUM_MAX_MEMORY_SLOTS } from '@/constants/premium';

const MEMORIES_KEY = 'local_ai_memories';
const MAX_MEMORIES_PREMIUM = PREMIUM_MAX_MEMORY_SLOTS;
const MAX_MEMORIES_FREE = FREE_TIER_LIMITS.MAX_MEMORY_SLOTS;

export interface Memory {
  id: string;
  content: string;
  createdAt: number;
  /** When it was last edited (Quo Sync keeps the later edit); absent until it is. */
  updatedAt?: number;
}

export type MemoryChangeListener = (memories: Memory[]) => void;

/** What changed, for Quo Sync: edits the user made, not ones sync applied itself. */
export interface MemoryChange {
  id: string;
  deleted: boolean;
}

// Minimum length for a partial (substring) match in deleteMemoryByContent.
// Shorter fragments ("a", "my") would match almost anything.
const MIN_SUBSTRING_MATCH_LENGTH = 8;

/**
 * Pick the memory a model-issued delete_memory call refers to.
 *
 * Policy (deliberately conservative — a wrong match silently deletes user data):
 * 1. Empty/whitespace query → no match.
 * 2. Exact match (case-insensitive, trimmed) wins.
 * 3. Otherwise a substring match, but only if the query is at least
 *    MIN_SUBSTRING_MATCH_LENGTH chars AND exactly one memory contains it.
 * 4. Anything else (ambiguous or too short) → no match.
 */
export function findMemoryToDelete(memories: readonly Memory[], query: string): Memory | undefined {
  const needle = (query ?? '').trim().toLowerCase();
  if (!needle) return undefined;

  const exact = memories.find(m => m.content.trim().toLowerCase() === needle);
  if (exact) return exact;

  if (needle.length < MIN_SUBSTRING_MATCH_LENGTH) return undefined;

  const partial = memories.filter(m => m.content.toLowerCase().includes(needle));
  return partial.length === 1 ? partial[0] : undefined;
}

class MemoryService {
  private static instance: MemoryService;
  private memories: Memory[] = [];
  private initialized = false;
  private listeners: Set<MemoryChangeListener> = new Set();
  private changeListeners: Set<(changes: MemoryChange[]) => void> = new Set();

  private constructor() {}

  static getInstance(): MemoryService {
    if (!MemoryService.instance) {
      MemoryService.instance = new MemoryService();
    }
    return MemoryService.instance;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    try {
      const data = await AsyncStorage.getItem(MEMORIES_KEY);
      if (data) {
        this.memories = JSON.parse(data);
      }
      this.initialized = true;
    } catch (error) {
      console.error('[MemoryService] Failed to load:', error);
      this.memories = [];
      this.initialized = true;
    }
  }

  private async save(): Promise<void> {
    try {
      await AsyncStorage.setItem(MEMORIES_KEY, JSON.stringify(this.memories));
      this.notifyListeners();
    } catch (error) {
      console.error('[MemoryService] Failed to save:', error);
    }
  }

  subscribe(listener: MemoryChangeListener): () => void {
    this.listeners.add(listener);
    void this.initialize()
      .then(() => listener([...this.memories]))
      .catch(() => listener([]));
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    const copy = [...this.memories];
    this.listeners.forEach(l => l(copy));
  }

  /** Quo Sync: told when the user adds, edits or deletes a memory. */
  onChanges(listener: (changes: MemoryChange[]) => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  private announce(changes: MemoryChange[]): void {
    if (changes.length > 0) this.changeListeners.forEach(listener => listener(changes));
  }

  /** The memories as they are now. Call after `initialize()`. */
  snapshot(): Memory[] {
    return [...this.memories];
  }

  /** Quo Sync: writes a memory that came from another device (not announced back, and not held to the slot limit). */
  async putFromSync(memory: Memory): Promise<void> {
    await this.initialize();
    const index = this.memories.findIndex(m => m.id === memory.id);
    this.memories = index === -1 ? [...this.memories, memory] : this.memories.map((m, i) => (i === index ? memory : m));
    await this.save();
  }

  async removeFromSync(id: string): Promise<void> {
    await this.initialize();
    this.memories = this.memories.filter(m => m.id !== id);
    await this.save();
  }

  async addMemory(content: string, isPremium: boolean = true): Promise<Memory> {
    await this.initialize();
    
    // Check for duplicate
    const existing = this.memories.find(m => 
      m.content.toLowerCase() === content.toLowerCase()
    );
    if (existing) return existing;

    const maxMemories = isPremium ? MAX_MEMORIES_PREMIUM : MAX_MEMORIES_FREE;
    
    if (this.memories.length >= maxMemories) {
      throw new Error(isPremium
        ? 'Memory limit reached.'
        : 'Memory is full. Premium unlocks more memory slots.');
    }

    const memory: Memory = {
      // Random suffix: two adds in the same millisecond (e.g. several
      // save_memory tool calls in one turn) must not share an id.
      id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      content,
      createdAt: Date.now(),
    };

    this.memories.push(memory);
    await this.save();
    this.announce([{ id: memory.id, deleted: false }]);
    return memory;
  }

  async deleteMemory(id: string): Promise<void> {
    await this.initialize();
    this.memories = this.memories.filter(m => m.id !== id);
    await this.save();
    this.announce([{ id, deleted: true }]);
  }

  /**
   * Edit a memory's content in place (keeps id/createdAt, so it never
   * counts against the slot limit). Throws on empty content or unknown id.
   */
  async updateMemory(id: string, content: string): Promise<Memory> {
    await this.initialize();
    const trimmed = content.trim();
    if (!trimmed) {
      throw new Error('Memory content cannot be empty.');
    }
    const index = this.memories.findIndex(m => m.id === id);
    if (index === -1) {
      throw new Error('Memory not found.');
    }
    const updated: Memory = { ...this.memories[index], content: trimmed, updatedAt: Date.now() };
    this.memories = this.memories.map((m, i) => (i === index ? updated : m));
    await this.save();
    this.announce([{ id, deleted: false }]);
    return updated;
  }

  async deleteMemoryByContent(content: string): Promise<boolean> {
    await this.initialize();
    const target = findMemoryToDelete(this.memories, content);
    if (!target) return false;
    // Filter by reference: legacy ids (`mem_<ms>`) can collide.
    this.memories = this.memories.filter(m => m !== target);
    await this.save();
    this.announce([{ id: target.id, deleted: true }]);
    return true;
  }

  async clearAllMemories(): Promise<void> {
    const ids = this.memories.map(m => m.id);
    this.memories = [];
    await this.save();
    this.announce(ids.map(id => ({ id, deleted: true })));
  }

  async getMemories(): Promise<Memory[]> {
    await this.initialize();
    return [...this.memories];
  }

  getMaxMemories(isPremium: boolean = true): number {
    return isPremium ? MAX_MEMORIES_PREMIUM : MAX_MEMORIES_FREE;
  }
}

export const memoryService = MemoryService.getInstance();
