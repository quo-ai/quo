import AsyncStorage from '@react-native-async-storage/async-storage';
import { findMemoryToDelete, memoryService, Memory } from '../memory';

const mem = (id: string, content: string): Memory => ({ id, content, createdAt: 1 });

describe('findMemoryToDelete', () => {
  const memories = [
    mem('1', 'User name is Alex'),
    mem('2', 'User likes dark roast coffee'),
    mem('3', 'User lives in Berlin'),
    mem('4', 'User likes dark chocolate'),
  ];

  it('rejects empty and whitespace queries', () => {
    expect(findMemoryToDelete(memories, '')).toBeUndefined();
    expect(findMemoryToDelete(memories, '   ')).toBeUndefined();
  });

  it('prefers an exact match (case-insensitive, trimmed)', () => {
    expect(findMemoryToDelete(memories, '  user LIVES in berlin ')?.id).toBe('3');
  });

  it('exact match wins even when the query is also a substring of others', () => {
    const list = [mem('a', 'Likes tea and biscuits'), mem('b', 'Likes tea')];
    expect(findMemoryToDelete(list, 'likes tea')?.id).toBe('b');
  });

  it('rejects short substring queries', () => {
    expect(findMemoryToDelete(memories, 'Alex')).toBeUndefined();
    expect(findMemoryToDelete(memories, 'a')).toBeUndefined();
  });

  it('accepts a unique substring of at least 8 chars', () => {
    expect(findMemoryToDelete(memories, 'roast coffee')?.id).toBe('2');
    expect(findMemoryToDelete(memories, 'NAME IS ALEX')?.id).toBe('1');
  });

  it('rejects ambiguous substring matches', () => {
    expect(findMemoryToDelete(memories, 'User likes dark')).toBeUndefined();
  });

  it('returns undefined when nothing matches', () => {
    expect(findMemoryToDelete(memories, 'completely unrelated')).toBeUndefined();
    expect(findMemoryToDelete([], 'anything at all')).toBeUndefined();
  });
});

describe('memoryService', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    await memoryService.clearAllMemories();
  });

  it('deleteMemoryByContent only deletes the matched memory', async () => {
    await memoryService.addMemory('User name is Alex');
    await memoryService.addMemory('User lives in Berlin');
    expect(await memoryService.deleteMemoryByContent('a')).toBe(false);
    expect(await memoryService.deleteMemoryByContent('lives in Berlin')).toBe(true);
    const remaining = await memoryService.getMemories();
    expect(remaining.map(m => m.content)).toEqual(['User name is Alex']);
  });

  it('updateMemory edits in place, preserving id/createdAt, even at the free limit', async () => {
    const max = memoryService.getMaxMemories(false);
    for (let i = 0; i < max; i++) {
      await memoryService.addMemory(`fact number ${i}`, false);
    }
    const [first] = await memoryService.getMemories();
    const listener = jest.fn();
    const unsubscribe = memoryService.subscribe(listener);

    const updated = await memoryService.updateMemory(first.id, '  edited fact  ');
    unsubscribe();

    expect(updated).toEqual({ ...first, content: 'edited fact' });
    const all = await memoryService.getMemories();
    expect(all).toHaveLength(max);
    expect(all[0]).toEqual(updated);
    expect(listener).toHaveBeenCalledWith(expect.arrayContaining([updated]));
    expect(JSON.parse((await AsyncStorage.getItem('local_ai_memories'))!)[0].content).toBe('edited fact');
  });

  it('updateMemory rejects empty content and unknown ids', async () => {
    const m = await memoryService.addMemory('keep me');
    await expect(memoryService.updateMemory(m.id, '   ')).rejects.toThrow();
    await expect(memoryService.updateMemory('nope', 'x')).rejects.toThrow();
    expect((await memoryService.getMemories())[0].content).toBe('keep me');
  });
});
