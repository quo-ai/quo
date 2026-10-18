import AsyncStorage from '@react-native-async-storage/async-storage';
import { memoryService } from '@/services/memory';
import { __resetStorageCacheForTests, onConversationChanges, saveConversations } from '@/services/storage';
import type { Conversation } from '@/types/chat';
import { chatStorage, ConcurrentEditError, memoryStorage, NotReadyError } from '../adapters';
import { registerChatBridge, type ChatBridge } from '../bridge';
import { chatFingerprint, toWireChat } from '../convert';

const chat = (id: string, updatedAt: number, messages = [`${id}-1`]): Conversation => ({
  id, title: id, createdAt: 1, updatedAt,
  messages: messages.map(m => ({ id: m, role: 'user' as const, content: m, timestamp: updatedAt })),
});

function fakeBridge(initial: Conversation[]) {
  const state = { list: initial };
  const bridge: ChatBridge = {
    getAll: () => state.list,
    apply: (conversation, expected) => {
      const existing = state.list.find(c => c.id === conversation.id);
      if ((existing ? chatFingerprint(existing) : null) !== expected) return false;
      state.list = existing ? state.list.map(c => (c.id === conversation.id ? conversation : c)) : [conversation, ...state.list];
      return true;
    },
    remove: (id, expected) => {
      const existing = state.list.find(c => c.id === id);
      if ((existing ? chatFingerprint(existing) : null) !== expected) return false;
      state.list = state.list.filter(c => c.id !== id);
      return true;
    },
    flush: async () => {},
    busy: () => false,
  };
  return { state, bridge };
}

let unregister: () => void = () => {};
afterEach(() => unregister());

describe('chats as the sync engine sees them', () => {
  it('cannot be used before the chats have loaded', async () => {
    await expect(chatStorage.get('a')).rejects.toBeInstanceOf(NotReadyError);
    await expect(chatStorage.all()).rejects.toBeInstanceOf(NotReadyError);
  });

  it('reads a chat in wire form, and says when it is missing', async () => {
    const { bridge } = fakeBridge([chat('a', 10)]);
    unregister = registerChatBridge(bridge);
    expect(await chatStorage.get('a')).toEqual(toWireChat(chat('a', 10)));
    expect(await chatStorage.get('nope')).toBeUndefined();
    expect((await chatStorage.all()).map(c => c.id)).toEqual(['a']);
  });

  it('writes a chat it read, merging into the one on the phone', async () => {
    const { state, bridge } = fakeBridge([chat('a', 10)]);
    unregister = registerChatBridge(bridge);
    const wire = (await chatStorage.get('a'))!;
    await chatStorage.put({ ...wire, updatedAt: 20, messages: [...wire.messages, { id: 'a-2', role: 'assistant', content: 'from the web' }] });
    expect(state.list[0].messages.map(m => m.id)).toEqual(['a-1', 'a-2']);
    expect(state.list[0].updatedAt).toBe(20);
  });

  it('adds a chat it has never seen', async () => {
    const { state, bridge } = fakeBridge([]);
    unregister = registerChatBridge(bridge);
    await chatStorage.put(toWireChat(chat('new', 5)));
    expect(state.list.map(c => c.id)).toEqual(['new']);
  });

  it('stops, rather than overwrite, a chat the user edited after it was read', async () => {
    const { state, bridge } = fakeBridge([chat('a', 10)]);
    unregister = registerChatBridge(bridge);
    const wire = (await chatStorage.get('a'))!;
    state.list = [chat('a', 11, ['a-1', 'typed-just-now'])];
    await expect(chatStorage.put({ ...wire, updatedAt: 30 })).rejects.toBeInstanceOf(ConcurrentEditError);
    expect(state.list[0].messages).toHaveLength(2);
  });

  it('removes a chat it read, and refuses if the user touched it since', async () => {
    const { state, bridge } = fakeBridge([chat('a', 10), chat('b', 10)]);
    unregister = registerChatBridge(bridge);
    await chatStorage.get('a');
    await chatStorage.remove('a');
    expect(state.list.map(c => c.id)).toEqual(['b']);
    await chatStorage.get('b');
    state.list = [chat('b', 99)];
    await expect(chatStorage.remove('b')).rejects.toBeInstanceOf(ConcurrentEditError);
    expect(state.list).toHaveLength(1);
  });

  describe('what it writes is not mistaken for the user editing', () => {
    beforeEach(async () => {
      await AsyncStorage.clear();
      __resetStorageCacheForTests();
    });

    it('is not announced when the chat is later saved to disk, but the next user edit is', async () => {
      const { state, bridge } = fakeBridge([]);
      unregister = registerChatBridge(bridge);
      const heard: string[] = [];
      onConversationChanges(changes => heard.push(...changes.map(c => c.id)));
      await chatStorage.put(toWireChat(chat('fromsync', 5)));
      await saveConversations(state.list); // what the debounced save does
      expect(heard).toEqual([]);
      await saveConversations([chat('fromsync', 6, ['fromsync-1', 'user-added'])]);
      expect(heard).toEqual(['fromsync']);
    });
  });
});

describe('memories as the sync engine sees them', () => {
  beforeEach(async () => {
    await memoryService.clearAllMemories();
  });

  it('reads them in wire form', async () => {
    const memory = await memoryService.addMemory('Likes tea');
    expect(await memoryStorage.get(memory.id)).toEqual({ id: memory.id, content: 'Likes tea', createdAt: memory.createdAt, updatedAt: memory.createdAt });
    expect((await memoryStorage.all()).map(m => m.content)).toEqual(['Likes tea']);
    expect(await memoryStorage.get('nope')).toBeUndefined();
  });

  it('writes and removes them without announcing, and shows them in the app', async () => {
    const heard = jest.fn();
    const stop = memoryService.onChanges(heard);
    await memoryStorage.put({ id: 'mem_1760_abcdef', content: 'Lives in York', createdAt: 1, updatedAt: 2 });
    expect((await memoryService.getMemories()).map(m => m.content)).toEqual(['Lives in York']);
    await memoryStorage.remove('mem_1760_abcdef');
    expect(await memoryService.getMemories()).toEqual([]);
    expect(heard).not.toHaveBeenCalled();
    stop();
  });
});
