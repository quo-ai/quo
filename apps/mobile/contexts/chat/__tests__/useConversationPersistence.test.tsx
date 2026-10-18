import React from 'react';
import { AppState } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import type { Conversation } from '@/types/chat';
import { useConversationPersistence } from '../useConversationPersistence';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockSave = jest.fn(async (_list: Conversation[]) => true);
const mockDelete = jest.fn(async (_ids: string[], _options?: { quiet?: boolean }) => true);
let mockWritten: Promise<unknown> = Promise.resolve();

jest.mock('@/services/storage', () => ({
  saveConversations: (list: Conversation[]) => mockSave(list),
  deleteConversationRows: (ids: string[], options?: { quiet?: boolean }) => mockDelete(ids, options),
  capConversationsForFreeTier: (list: Conversation[], max: number) => [...list].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, max),
  whenWritten: () => mockWritten,
}));
jest.mock('@/constants/premium', () => ({ FREE_TIER_LIMITS: { MAX_CHAT_HISTORY: 2 } }));

const chat = (id: string, updatedAt: number): Conversation => ({ id, title: id, createdAt: 1, updatedAt, messages: [] });

function mount(initial: Conversation[], options: { isPremium?: boolean } = {}) {
  const latest = { current: initial };
  let flush!: () => Promise<void>;
  const setConversations = jest.fn((action: unknown) => {
    latest.current = typeof action === 'function' ? (action as (p: Conversation[]) => Conversation[])(latest.current) : (action as Conversation[]);
  });
  function Harness({ conversations }: { conversations: Conversation[] }) {
    ({ flush } = useConversationPersistence({
      conversations,
      getLatest: () => latest.current,
      setConversations: setConversations as never,
      currentConversation: null,
      setCurrentConversation: jest.fn(),
      isLoading: false,
      isPremium: options.isPremium ?? true,
    }));
    return null;
  }
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<Harness conversations={initial} />);
  });
  return {
    latest,
    flush: () => flush(),
    setConversations,
    // As in the app, state and the always-current ref change together.
    rerender: (conversations: Conversation[]) => {
      latest.current = conversations;
      act(() => renderer.update(<Harness conversations={conversations} />));
    },
    unmount: () => act(() => renderer.unmount()),
  };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockWritten = Promise.resolve();
});
afterEach(() => jest.useRealTimers());

describe('saving chats', () => {
  it('waits for a quiet moment, then saves', () => {
    const { unmount } = mount([chat('a', 1)]);
    expect(mockSave).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(499); });
    expect(mockSave).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(1); });
    expect(mockSave).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('saves once after a burst of changes, not after each', () => {
    const { rerender, unmount } = mount([chat('a', 1)]);
    act(() => { jest.advanceTimersByTime(300); });
    rerender([chat('a', 2)]);
    act(() => { jest.advanceTimersByTime(300); });
    rerender([chat('a', 3)]);
    act(() => { jest.advanceTimersByTime(500); });
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockSave.mock.calls[0][0][0].updatedAt).toBe(3);
    unmount();
  });

  it('writes the chats as they are when the save runs, not as they were when it was scheduled', () => {
    const { latest, unmount } = mount([chat('a', 1)]);
    latest.current = [chat('a', 2), chat('b', 2)]; // changed after the render that scheduled the save
    act(() => { jest.advanceTimersByTime(500); });
    expect(mockSave.mock.calls[0][0].map(c => c.id)).toEqual(['a', 'b']);
    unmount();
  });
});

describe('flushing (what Quo Sync does before it merges)', () => {
  it('writes an edit that is still waiting, at once, with the latest chats', async () => {
    const { latest, flush, unmount } = mount([chat('a', 1)]);
    latest.current = [chat('a', 2), chat('b', 2)]; // an edit React hasn't rendered yet
    await flush();
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockSave.mock.calls[0][0].map(c => c.id)).toEqual(['a', 'b']);
    act(() => { jest.advanceTimersByTime(1000); });
    expect(mockSave).toHaveBeenCalledTimes(1); // the debounce doesn't save it again
    unmount();
  });

  it('does nothing when nothing is waiting', async () => {
    const { flush, unmount } = mount([chat('a', 1)]);
    act(() => { jest.advanceTimersByTime(500); });
    mockSave.mockClear();
    await flush();
    expect(mockSave).not.toHaveBeenCalled();
    unmount();
  });

  it('resolves only once the writes have finished', async () => {
    const { flush, unmount } = mount([chat('a', 1)]);
    let release!: () => void;
    mockWritten = new Promise<void>(resolve => { release = resolve; });
    let done = false;
    const flushed = flush().then(() => { done = true; });
    await Promise.resolve();
    await Promise.resolve();
    expect(done).toBe(false);
    release();
    await flushed;
    expect(done).toBe(true);
    unmount();
  });
});

describe('the free tier’s limit', () => {
  it('trims old chats from the saved list and the screen, and tells sync nothing', () => {
    const { latest, unmount } = mount([chat('new', 30), chat('mid', 20), chat('old', 10)], { isPremium: false });
    act(() => { jest.advanceTimersByTime(500); });
    expect(mockSave.mock.calls[0][0].map(c => c.id)).toEqual(['new', 'mid']);
    expect(latest.current.map(c => c.id)).toEqual(['new', 'mid']);
    expect(mockDelete).toHaveBeenCalledWith(['old'], { quiet: true });
    unmount();
  });

  it('keeps everything for Premium', () => {
    const { unmount } = mount([chat('a', 30), chat('b', 20), chat('c', 10)]);
    act(() => { jest.advanceTimersByTime(500); });
    expect(mockSave.mock.calls[0][0]).toHaveLength(3);
    expect(mockDelete).not.toHaveBeenCalled();
    unmount();
  });
});

describe('leaving the app', () => {
  it('saves a waiting edit when the app goes to the background', () => {
    let listener: (state: string) => void = () => {};
    const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation(((_event: string, handler: (state: string) => void) => {
      listener = handler;
      return { remove: jest.fn() };
    }) as never);
    const { unmount } = mount([chat('a', 1)]);
    listener('active');
    expect(mockSave).not.toHaveBeenCalled();
    listener('background');
    expect(mockSave).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    unmount();
  });
});
