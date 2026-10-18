import AsyncStorage from '@react-native-async-storage/async-storage';
import { chatFingerprint } from '@/services/sync/convert';
import { __resetStorageCacheForTests, loadConversations, onConversationChanges, saveConversations } from '@/services/storage';
import type { Conversation } from '@/types/chat';
import { createChatBridge, upsertConversation } from '../syncBridge';

const chat = (id: string, updatedAt: number, extra: Partial<Conversation> = {}): Conversation => ({
  id, title: id, createdAt: 1, updatedAt, messages: [{ id: `${id}-1`, role: 'user', content: 'hi', timestamp: updatedAt }], ...extra,
});

describe('upsertConversation', () => {
  it('replaces a chat in place', () => {
    const list = [chat('a', 30), chat('b', 20), chat('c', 10)];
    const replaced = upsertConversation(list, chat('b', 99, { title: 'edited' }));
    expect(replaced.map(c => c.id)).toEqual(['a', 'b', 'c']);
    expect(replaced[1].title).toBe('edited');
  });

  it('adds a new chat where its time puts it, newest first', () => {
    const list = [chat('a', 30), chat('c', 10)];
    expect(upsertConversation(list, chat('b', 20)).map(c => c.id)).toEqual(['a', 'b', 'c']);
    expect(upsertConversation(list, chat('new', 99)).map(c => c.id)).toEqual(['new', 'a', 'c']);
    expect(upsertConversation(list, chat('old', 1)).map(c => c.id)).toEqual(['a', 'c', 'old']);
    expect(upsertConversation([], chat('only', 1)).map(c => c.id)).toEqual(['only']);
  });
});

describe('the chat bridge', () => {
  function setup(initial: Conversation[]) {
    const state: { list: Conversation[]; current: Conversation | null } = { list: initial, current: initial[0] ?? null };
    const ref = { get current() { return state.list; }, set current(value: Conversation[]) { state.list = value; } };
    const flush = jest.fn(async () => {});
    const bridge = createChatBridge({
      conversations: ref,
      setConversations: update => { state.list = update(state.list); },
      setCurrentConversation: update => { state.current = update(state.current); },
      flush,
      busy: () => false,
      onRemoved: jest.fn(),
    });
    return { state, bridge, flush };
  }

  it('shows the chats as they are, and can write a flush', async () => {
    const { bridge, flush } = setup([chat('a', 10)]);
    expect(bridge.getAll().map(c => c.id)).toEqual(['a']);
    await bridge.flush();
    expect(flush).toHaveBeenCalled();
  });

  it('applies a chat that is as sync last read it, updating the open chat too', () => {
    const a = chat('a', 10);
    const { state, bridge } = setup([a]);
    const next = chat('a', 50, { title: 'from elsewhere' });
    expect(bridge.apply(next, chatFingerprint(a))).toBe(true);
    expect(state.list[0].title).toBe('from elsewhere');
    expect(state.current?.title).toBe('from elsewhere');
  });

  it('adds a chat that did not exist, only if sync saw it as missing', () => {
    const { state, bridge } = setup([chat('a', 10)]);
    expect(bridge.apply(chat('b', 20), null)).toBe(true);
    expect(state.list.map(c => c.id)).toEqual(['b', 'a']);
    expect(bridge.apply(chat('b', 30), null)).toBe(false); // it exists now, so "missing" is out of date
  });

  it('refuses to overwrite a chat the user changed since sync read it', () => {
    const a = chat('a', 10);
    const { state, bridge } = setup([a]);
    const seen = chatFingerprint(a);
    state.list = [{ ...a, updatedAt: 11, messages: [...a.messages, { id: 'a-2', role: 'user', content: 'typed just now', timestamp: 11 }] }];
    expect(bridge.apply(chat('a', 50, { title: 'remote' }), seen)).toBe(false);
    expect(state.list[0].messages).toHaveLength(2);
    expect(state.list[0].title).toBe('a');
  });

  it('removes a chat that is unchanged, and clears the open chat if it was that one', () => {
    const a = chat('a', 10);
    const { state, bridge } = setup([a, chat('b', 5)]);
    expect(bridge.remove('a', chatFingerprint(a))).toBe(true);
    expect(state.list.map(c => c.id)).toEqual(['b']);
    expect(state.current).toBeNull();
  });

  it('refuses to remove a chat that changed since sync read it', () => {
    const a = chat('a', 10);
    const { state, bridge } = setup([a]);
    expect(bridge.remove('a', 'stale')).toBe(false);
    expect(state.list).toHaveLength(1);
  });

  describe('deleting is quiet', () => {
    beforeEach(async () => {
      await AsyncStorage.clear();
      __resetStorageCacheForTests();
    });

    it('removes the saved chat without telling sync the user deleted it', async () => {
      const a = chat('a', 10);
      await saveConversations([a, chat('b', 5)]);
      const heard: string[] = [];
      onConversationChanges(changes => heard.push(...changes.map(c => c.id)));
      const { bridge } = setup([a]);
      expect(bridge.remove('a', chatFingerprint(a))).toBe(true);
      await new Promise(resolve => setTimeout(resolve, 0));
      await Promise.resolve();
      expect(heard).toEqual([]);
      __resetStorageCacheForTests();
      expect((await loadConversations()).map(c => c.id)).toEqual(['b']);
    });
  });
});
