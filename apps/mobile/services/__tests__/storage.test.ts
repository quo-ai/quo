import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  loadConversations,
  saveConversations,
  deleteConversationRows,
  clearConversationRows,
  capConversationsForFreeTier,
  clearAllData,
  markSyncApplied,
  onConversationChanges,
  __resetStorageCacheForTests,
} from '../storage';
import type { ConversationChange } from '../storage';
import { Conversation } from '@/types/chat';

const LEGACY_KEY = 'local_ai_conversations';
const INDEX_KEY = 'local_ai_conversation_index';
const rowKey = (id: string) => `local_ai_conversation:${id}`;

function makeConversation(id: string, updatedAt: number): Conversation {
  return {
    id,
    title: `Chat ${id}`,
    messages: [{ id: `${id}-m1`, role: 'user', content: 'hello', timestamp: updatedAt }],
    createdAt: updatedAt,
    updatedAt,
  };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  __resetStorageCacheForTests();
  jest.clearAllMocks();
});

describe('conversation storage (per-row format)', () => {
  it('round-trips conversations sorted by recency', async () => {
    const a = makeConversation('a', 1000);
    const b = makeConversation('b', 2000);
    await saveConversations([a, b]);

    __resetStorageCacheForTests(); // simulate a fresh app start
    const loaded = await loadConversations();
    expect(loaded.map(c => c.id)).toEqual(['b', 'a']);
  });

  it('stores each conversation under its own key plus an index', async () => {
    await saveConversations([makeConversation('a', 1000)]);
    expect(await AsyncStorage.getItem(rowKey('a'))).toBeTruthy();
    expect(JSON.parse((await AsyncStorage.getItem(INDEX_KEY))!)).toEqual(['a']);
  });

  it('migrates the legacy single-blob format on first load', async () => {
    const legacy = [makeConversation('old1', 1000), makeConversation('old2', 2000)];
    await AsyncStorage.setItem(LEGACY_KEY, JSON.stringify(legacy));

    const loaded = await loadConversations();
    expect(loaded.map(c => c.id)).toEqual(['old2', 'old1']);
    expect(await AsyncStorage.getItem(LEGACY_KEY)).toBeNull();
    expect(await AsyncStorage.getItem(rowKey('old1'))).toBeTruthy();
    expect(JSON.parse((await AsyncStorage.getItem(INDEX_KEY))!)).toEqual(['old2', 'old1']);
  });

  it('never deletes rows implicitly when a conversation drops out of the list', async () => {
    await loadConversations();
    await saveConversations([makeConversation('a', 1000), makeConversation('b', 2000)]);
    await saveConversations([makeConversation('a', 1000)]);
    expect(await AsyncStorage.getItem(rowKey('b'))).toBeTruthy();
    expect(JSON.parse((await AsyncStorage.getItem(INDEX_KEY))!)).toEqual(['a']);
  });

  it('deleteConversationRows removes rows and their index entries', async () => {
    await loadConversations();
    await saveConversations([makeConversation('a', 1000), makeConversation('b', 2000)]);
    expect(await deleteConversationRows(['b'])).toBe(true);
    expect(await AsyncStorage.getItem(rowKey('b'))).toBeNull();
    expect(await AsyncStorage.getItem(rowKey('a'))).toBeTruthy();
    expect(JSON.parse((await AsyncStorage.getItem(INDEX_KEY))!)).toEqual(['a']);
  });

  it('clearConversationRows removes every row and the index', async () => {
    await saveConversations([makeConversation('a', 1000), makeConversation('b', 2000)]);
    await clearConversationRows();
    expect(await AsyncStorage.getItem(rowKey('a'))).toBeNull();
    expect(await AsyncStorage.getItem(INDEX_KEY)).toBeNull();
  });

  it('skips rewriting unchanged conversations on subsequent saves', async () => {
    const a = makeConversation('a', 1000);
    await saveConversations([a]);
    const writesAfterFirst = (AsyncStorage.multiSet as jest.Mock).mock.calls.length;

    await saveConversations([a]);
    expect((AsyncStorage.multiSet as jest.Mock).mock.calls.length).toBe(writesAfterFirst);

    await saveConversations([{ ...a, updatedAt: 2000 }]);
    expect((AsyncStorage.multiSet as jest.Mock).mock.calls.length).toBe(writesAfterFirst + 1);
  });

  it('rewrites a conversation when only its context summary changes', async () => {
    const a = makeConversation('a', 1000);
    await saveConversations([a]);
    const writesAfterFirst = (AsyncStorage.multiSet as jest.Mock).mock.calls.length;

    await saveConversations([
      { ...a, contextSummary: { text: 'digest', coversMessageCount: 1, updatedAt: 5000 } },
    ]);
    expect((AsyncStorage.multiSet as jest.Mock).mock.calls.length).toBe(writesAfterFirst + 1);

    __resetStorageCacheForTests();
    const loaded = await loadConversations();
    expect(loaded[0].contextSummary?.text).toBe('digest');
  });

  it('strips image base64 and extracted document text before persisting', async () => {
    const a = makeConversation('a', 1000);
    a.messages[0].image = { uri: 'file://x', width: 1, height: 1, base64: 'HUGE' };
    a.messages[0].document = { uri: 'y', name: 'doc.pdf', mimeType: 'application/pdf', size: 1, extractedText: 'HUGE TEXT' };
    await saveConversations([a]);

    const stored = JSON.parse((await AsyncStorage.getItem(rowKey('a')))!);
    expect(stored.messages[0].image.base64).toBeUndefined();
    expect(stored.messages[0].document.extractedText).toBe('');
  });

  it('clearAllData removes index, rows, settings, and legacy key', async () => {
    await saveConversations([makeConversation('a', 1000)]);
    await clearAllData();
    expect(await AsyncStorage.getItem(INDEX_KEY)).toBeNull();
    expect(await AsyncStorage.getItem(rowKey('a'))).toBeNull();
  });
});

describe('load-failure guard', () => {
  it('does not clobber the stored index when the load failed', async () => {
    await saveConversations([makeConversation('a', 1000), makeConversation('b', 2000)]);
    __resetStorageCacheForTests();

    const getItem = AsyncStorage.getItem as jest.Mock;
    getItem.mockImplementationOnce(async () => {
      throw new Error('disk I/O error');
    });
    expect(await loadConversations()).toEqual([]);

    // The app now believes history is empty and saves a brand-new chat.
    expect(await saveConversations([makeConversation('c', 3000)])).toBe(true);
    const index = JSON.parse((await AsyncStorage.getItem(INDEX_KEY))!);
    expect(index).toEqual(expect.arrayContaining(['a', 'b', 'c']));
    expect(await AsyncStorage.getItem(rowKey('a'))).toBeTruthy();
  });

  it('falls back to per-row reads when multiGet fails, skipping only bad rows', async () => {
    await saveConversations([makeConversation('a', 1000), makeConversation('b', 2000)]);
    __resetStorageCacheForTests();

    // AsyncStorage's mock routes getItem through multiGet, so failing any
    // read that touches row b covers both the batch and per-key paths.
    const multiGet = AsyncStorage.multiGet as jest.Mock;
    const realMultiGet = multiGet.getMockImplementation()!;
    multiGet.mockImplementation(async (keys: string[], ...rest: unknown[]) => {
      if (keys.includes(rowKey('b'))) throw new Error('Row too big to fit into CursorWindow');
      return realMultiGet(keys, ...rest);
    });

    try {
      const loaded = await loadConversations();
      expect(loaded.map(c => c.id)).toEqual(['a']);

      // The unreadable row stays indexed and on disk after the next save.
      await saveConversations([{ ...loaded[0], updatedAt: 5000 }]);
      expect(JSON.parse((await AsyncStorage.getItem(INDEX_KEY))!)).toEqual(['a', 'b']);
    } finally {
      multiGet.mockImplementation(realMultiGet);
    }
    expect(await AsyncStorage.getItem(rowKey('b'))).toBeTruthy();
  });

  it('keeps the legacy blob when migrating its rows fails', async () => {
    const legacy = [makeConversation('old1', 1000)];
    await AsyncStorage.setItem(LEGACY_KEY, JSON.stringify(legacy));
    (AsyncStorage.multiSet as jest.Mock).mockImplementationOnce(async () => {
      throw new Error('SQLITE_FULL');
    });

    const loaded = await loadConversations();
    expect(loaded.map(c => c.id)).toEqual(['old1']);
    expect(await AsyncStorage.getItem(LEGACY_KEY)).toBeTruthy();

    // The next successful save completes the migration.
    expect(await saveConversations(loaded)).toBe(true);
    expect(await AsyncStorage.getItem(LEGACY_KEY)).toBeNull();
    expect(await AsyncStorage.getItem(rowKey('old1'))).toBeTruthy();
  });
});

describe('capConversationsForFreeTier', () => {
  it('keeps the newest N conversations', () => {
    const conversations = [makeConversation('a', 1), makeConversation('b', 3), makeConversation('c', 2)];
    const capped = capConversationsForFreeTier(conversations, 2);
    expect(capped.map(c => c.id)).toEqual(['b', 'c']);
  });

  it('returns the input untouched when under the cap', () => {
    const conversations = [makeConversation('a', 1)];
    expect(capConversationsForFreeTier(conversations, 2)).toBe(conversations);
  });
});

describe('telling Quo Sync what changed', () => {
  const heard: ConversationChange[][] = [];
  let stop: () => void;

  beforeEach(() => {
    heard.length = 0;
    stop = onConversationChanges(changes => heard.push(changes));
  });
  afterEach(() => stop());

  const flat = () => heard.flat().map(change => `${change.id}${change.deleted ? ' deleted' : ''}`);

  it('announces a chat the first time it is saved, and again when it changes', async () => {
    const a = makeConversation('a', 1000);
    await saveConversations([a]);
    expect(flat()).toEqual(['a']);
    await saveConversations([a]); // nothing changed
    expect(flat()).toEqual(['a']);
    await saveConversations([{ ...a, updatedAt: 2000, messages: [...a.messages, { id: 'a-m2', role: 'assistant', content: 'hi', timestamp: 2000 }] }]);
    expect(flat()).toEqual(['a', 'a']);
  });

  it('does not announce chats it only loaded', async () => {
    await saveConversations([makeConversation('a', 1000)]);
    __resetStorageCacheForTests();
    stop();
    stop = onConversationChanges(changes => heard.push(changes));
    heard.length = 0;
    const loaded = await loadConversations();
    await saveConversations(loaded);
    expect(flat()).toEqual([]);
  });

  it('does not announce a rewritten long-chat summary, which sync never sends', async () => {
    const a = makeConversation('a', 1000);
    await saveConversations([a]);
    heard.length = 0;
    await saveConversations([{ ...a, contextSummary: { text: 'digest', coversMessageCount: 1, updatedAt: 5 } }]);
    expect(flat()).toEqual([]);
  });

  it('does not announce what sync itself wrote', async () => {
    const fromSync = makeConversation('s', 3000);
    markSyncApplied(fromSync);
    await saveConversations([fromSync]);
    expect(flat()).toEqual([]);
    // ...but a later edit of it is the user's.
    await saveConversations([{ ...fromSync, updatedAt: 4000, messages: [...fromSync.messages, { id: 's-m2', role: 'user', content: 'more', timestamp: 4000 }] }]);
    expect(flat()).toEqual(['s']);
  });

  it('announces deletions the user makes, and clearing everything', async () => {
    await saveConversations([makeConversation('a', 1000), makeConversation('b', 2000), makeConversation('c', 3000)]);
    heard.length = 0;
    await deleteConversationRows(['a']);
    expect(flat()).toEqual(['a deleted']);
    await clearConversationRows();
    expect(flat().sort()).toEqual(['a deleted', 'b deleted', 'c deleted']);
  });

  it('does not announce quiet deletions: the free tier trimming, or sync applying a delete', async () => {
    await saveConversations([makeConversation('a', 1000), makeConversation('b', 2000)]);
    heard.length = 0;
    await deleteConversationRows(['a'], { quiet: true });
    expect(flat()).toEqual([]);
    expect(await AsyncStorage.getItem(rowKey('a'))).toBeNull();
  });

  it('announces a chat again if it comes back after being deleted', async () => {
    const a = makeConversation('a', 1000);
    await saveConversations([a]);
    await deleteConversationRows(['a']);
    heard.length = 0;
    await saveConversations([a]);
    expect(flat()).toEqual(['a']);
  });
});
