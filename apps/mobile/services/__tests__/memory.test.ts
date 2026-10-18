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

    expect(updated).toEqual({ ...first, content: 'edited fact', updatedAt: expect.any(Number) });
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

describe('memoryService and Quo Sync', () => {
  beforeEach(async () => {
    await memoryService.clearAllMemories();
  });

  it('announces what the user adds, edits and deletes, and only that', async () => {
    const seen: { id: string; deleted: boolean }[][] = [];
    const stop = memoryService.onChanges(changes => seen.push(changes));
    const added = await memoryService.addMemory('Likes tea');
    await memoryService.updateMemory(added.id, 'Likes green tea');
    await memoryService.deleteMemory(added.id);
    const second = await memoryService.addMemory('Lives in York');
    await memoryService.deleteMemoryByContent('Lives in York');
    await memoryService.addMemory('One');
    await memoryService.addMemory('Two');
    seen.length = 0;
    await memoryService.clearAllMemories();
    stop();
    expect(second.id).toBeTruthy();
    expect(seen).toHaveLength(1);
    expect(seen[0].every(change => change.deleted)).toBe(true);
    expect(seen[0]).toHaveLength(2);
  });

  it('records when a memory was edited, and not before', async () => {
    const memory = await memoryService.addMemory('Fact');
    expect(memory.updatedAt).toBeUndefined();
    const edited = await memoryService.updateMemory(memory.id, 'Better fact');
    expect(edited.updatedAt).toBeGreaterThanOrEqual(memory.createdAt);
  });

  it('applies what sync brings quietly, over the slot limit, and shows it in the app', async () => {
    const stop = memoryService.onChanges(() => {
      throw new Error('sync’s own writes must not be announced back to it');
    });
    const shown = jest.fn();
    const unsubscribe = memoryService.subscribe(shown);
    const max = memoryService.getMaxMemories(false);
    for (let i = 0; i < max + 3; i++) await memoryService.putFromSync({ id: `mem_sync_${i}`, content: `Fact ${i}`, createdAt: 1, updatedAt: 2 });
    expect(memoryService.snapshot()).toHaveLength(max + 3);
    await memoryService.putFromSync({ id: 'mem_sync_0', content: 'Changed', createdAt: 1, updatedAt: 3 });
    expect(memoryService.snapshot().find(m => m.id === 'mem_sync_0')?.content).toBe('Changed');
    expect(memoryService.snapshot()).toHaveLength(max + 3);
    await memoryService.removeFromSync('mem_sync_1');
    expect(memoryService.snapshot().some(m => m.id === 'mem_sync_1')).toBe(false);
    expect(shown).toHaveBeenCalled();
    expect(JSON.parse((await AsyncStorage.getItem('local_ai_memories'))!)).toHaveLength(max + 2);
    stop();
    unsubscribe();
  });
});
