/* eslint-disable @typescript-eslint/no-require-imports */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import type { Conversation } from '@/types/chat';

const secure = (SecureStore as unknown as { __secureStore: Map<string, string> }).__secureStore;

type Manager = typeof import('../index');
type Crypto = typeof import('../crypto');

const mockApi = jest.fn();
const mockStatus = jest.fn();
const mockPull = jest.fn();
const mockPush = jest.fn();
let mockVerifier: string | null = null;
let mockAppState = 'active';
const mockAppListeners: ((state: string) => void)[] = [];

// Only AppState is replaced; everything else in react-native is the real thing.
jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  return new Proxy(actual, { get: (target, prop) => (prop === 'AppState' ? (globalThis as { mockAppStateModule?: unknown }).mockAppStateModule : target[prop as keyof typeof target]) });
});
(globalThis as { mockAppStateModule?: unknown }).mockAppStateModule = {
  get currentState() { return mockAppState; },
  addEventListener: (_event: string, listener: (state: string) => void) => { mockAppListeners.push(listener); return { remove: jest.fn() }; },
};
jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  api: (...args: unknown[]) => mockApi(...args),
  remoteApi: {
    status: () => mockStatus(),
    pull: (...args: unknown[]) => mockPull(...args),
    push: (...args: unknown[]) => mockPush(...args),
  },
}));

function load(): { sync: Manager; crypto: Crypto; bridge: typeof import('../bridge'); api: typeof import('../api') } {
  let modules!: { sync: Manager; crypto: Crypto; bridge: typeof import('../bridge'); api: typeof import('../api') };
  jest.isolateModules(() => {
    modules = { sync: require('../index'), crypto: require('../crypto'), bridge: require('../bridge'), api: require('../api') };
  });
  return modules;
}

function readyBridge(bridge: typeof import('../bridge'), options: { busy?: boolean; chats?: Conversation[] } = {}) {
  const flush = jest.fn(async () => {});
  bridge.registerChatBridge({
    getAll: () => options.chats ?? [],
    apply: () => true,
    remove: () => true,
    flush,
    busy: () => options.busy ?? false,
  });
  return { flush };
}

const chat = (id: string): Conversation => ({ id, title: id, createdAt: 1, updatedAt: 2, messages: [{ id: `${id}-1`, role: 'user', content: 'hi', timestamp: 2 }] });
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const settle = async () => { for (let i = 0; i < 40; i++) { await tick(); await jest.advanceTimersByTimeAsync(1); } };

beforeEach(async () => {
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
  await AsyncStorage.clear();
  secure.clear();
  jest.clearAllMocks();
  mockAppState = 'active';
  mockAppListeners.length = 0;
  mockVerifier = null;
  // A server that remembers the verifier it was given, as the real one does.
  mockApi.mockImplementation(async (path: string, init?: { body?: { verifier?: string } }) => {
    if (path === 'sync/setup') mockVerifier = init!.body!.verifier!;
    return {};
  });
  mockStatus.mockImplementation(async () => ({ enabled: true, verifier: mockVerifier }));
  mockPull.mockResolvedValue({ records: [], seq: 0, more: false });
  mockPush.mockResolvedValue({ seq: 0, accepted: [], conflicts: [] });
});
afterEach(() => jest.useRealTimers());

describe('signing in', () => {
  it('keeps the token in secure storage and shows the account', async () => {
    const { sync } = load();
    mockApi.mockImplementation(async (path: string) => {
      if (path === 'auth/verify') return { token: 'tok.en' };
      if (path === 'me') return { user: { email: 'me@example.com' }, sync: true };
      return {};
    });
    await sync.verifySignIn('me@example.com', '123456');
    expect(mockApi).toHaveBeenCalledWith('auth/verify', { body: { email: 'me@example.com', code: '123456', client: 'app' } });
    expect(secure.get('quo.sync.token')).toBe('tok.en');
    expect(sync.useSyncAccount).toBeDefined();
    const account = await sync.refreshAccount();
    expect(account).toEqual({ email: 'me@example.com', entitled: true });
  });

  it('throws away a token the server no longer accepts', async () => {
    const { sync } = load();
    secure.set('quo.sync.token', 'stale');
    mockApi.mockResolvedValue({ user: null, sync: false });
    expect(await sync.refreshAccount()).toBeNull();
    expect(secure.has('quo.sync.token')).toBe(false);
  });

  it('signs out by forgetting the token, leaving sync set up', async () => {
    const { sync, crypto, bridge } = load();
    readyBridge(bridge);
    secure.set('quo.sync.token', 'tok');
    await sync.createSync(crypto.newRecoveryKey().secret, 'me@example.com');
    await sync.signOut();
    expect(secure.has('quo.sync.token')).toBe(false);
    expect(secure.has('quo.sync.key')).toBe(true);
    expect(sync.getSyncStatus().phase).not.toBe('off');
  });
});

describe('turning it on', () => {
  it('sets up the account with a verifier only the right recovery key opens, and starts syncing', async () => {
    const { sync, crypto, bridge } = load();
    readyBridge(bridge);
    const recovery = crypto.newRecoveryKey();
    await sync.createSync(recovery.secret, 'me@example.com');
    const [path, init] = mockApi.mock.calls.find(([p]) => p === 'sync/setup')!;
    expect(path).toBe('sync/setup');
    const key = crypto.deriveKey(recovery.secret);
    expect(crypto.checkVerifier(key, init.body.verifier)).toBe(true);
    expect(crypto.checkVerifier(crypto.deriveKey(crypto.newRecoveryKey().secret), init.body.verifier)).toBe(false);
    expect(secure.get('quo.sync.key')).toBe(crypto.keyToHex(key));
    expect(secure.get('quo.sync.key')).not.toContain(recovery.text);
    await settle();
    expect(mockStatus).toHaveBeenCalled(); // the first sync ran
    expect(sync.getSyncStatus()).toMatchObject({ phase: 'idle', email: 'me@example.com', error: null });
    expect(sync.getSyncStatus().lastSyncAt).not.toBeNull();
  });

  it('uploads what is already on the phone, chats and memories', async () => {
    const { sync, crypto, bridge } = load();
    const { memoryService } = require('@/services/memory');
    await memoryService.clearAllMemories();
    await memoryService.addMemory('Prefers metric units');
    readyBridge(bridge, { chats: [chat('1760-aaa'), chat('1760-bbb')] });
    const recovery = crypto.newRecoveryKey();
    mockStatus.mockResolvedValue({ enabled: true, verifier: crypto.makeVerifier(crypto.deriveKey(recovery.secret)) });
    mockPush.mockImplementation(async (records: { id: string }[]) => ({ seq: records.length, accepted: records.map((r, i) => ({ id: r.id, seq: i + 1 })), conflicts: [] }));
    await sync.createSync(recovery.secret, 'me@example.com');
    await settle();
    expect(sync.getSyncStatus().error).toBeNull();
    const pushed = mockPush.mock.calls.flatMap(([records]) => records as { id: string; kind: string }[]);
    expect(pushed.map(r => r.id).sort()).toEqual(['1760-aaa', '1760-bbb', expect.stringMatching(/^memory:mem_/)].sort());
    expect(pushed.filter(r => r.kind === 'memory')).toHaveLength(1);
  });

  it('does not start if the server refuses', async () => {
    const { sync, crypto } = load();
    mockApi.mockRejectedValue(new (load().api.ApiError)(402, 'sync_required', 'Needs a plan'));
    await expect(sync.createSync(crypto.newRecoveryKey().secret, 'me@example.com')).rejects.toMatchObject({ code: 'sync_required' });
    expect(secure.has('quo.sync.key')).toBe(false);
    expect(sync.getSyncStatus().phase).toBe('off');
  });
});

describe('joining', () => {
  const recovery = () => require('../crypto').newRecoveryKey() as { secret: Uint8Array; text: string };

  it('rejects something that is not a recovery key, without asking the server', async () => {
    const { sync } = load();
    await expect(sync.joinSync('ABCD-1234', 'me@example.com')).rejects.toMatchObject({ code: 'bad_format' });
    expect(mockStatus).not.toHaveBeenCalled();
  });

  it('says so when sync was never turned on', async () => {
    const { sync, crypto } = load();
    mockStatus.mockResolvedValue({ enabled: false, verifier: null });
    await expect(sync.joinSync(crypto.newRecoveryKey().text, 'me@example.com')).rejects.toMatchObject({ code: 'not_set_up' });
  });

  it('refuses the wrong recovery key and keeps nothing', async () => {
    const { sync, crypto } = load();
    mockStatus.mockResolvedValue({ enabled: true, verifier: crypto.makeVerifier(crypto.deriveKey(recovery().secret)) });
    await expect(sync.joinSync(recovery().text, 'me@example.com')).rejects.toMatchObject({ code: 'wrong_key' });
    expect(secure.has('quo.sync.key')).toBe(false);
    expect(sync.getSyncStatus().phase).toBe('off');
  });

  it('joins with the right one, however it is typed', async () => {
    const { sync, crypto, bridge } = load();
    readyBridge(bridge);
    const mine = recovery();
    mockStatus.mockResolvedValue({ enabled: true, verifier: crypto.makeVerifier(crypto.deriveKey(mine.secret)) });
    await sync.joinSync(mine.text.toLowerCase().replace(/-/g, ' '), 'me@example.com');
    expect(secure.get('quo.sync.key')).toBe(crypto.keyToHex(crypto.deriveKey(mine.secret)));
    await settle();
    expect(sync.getSyncStatus()).toMatchObject({ phase: 'idle', email: 'me@example.com', error: null });
  });
});

describe('turning it off', () => {
  it('forgets the key and the bookkeeping here, but not the account', async () => {
    const { sync, crypto, bridge } = load();
    readyBridge(bridge);
    secure.set('quo.sync.token', 'tok');
    await sync.createSync(crypto.newRecoveryKey().secret, 'me@example.com');
    await sync.disableSync();
    expect(secure.has('quo.sync.key')).toBe(false);
    expect(secure.get('quo.sync.token')).toBe('tok');
    expect(sync.getSyncStatus()).toMatchObject({ phase: 'off', email: null });
    expect(mockApi).not.toHaveBeenCalledWith('sync/reset', expect.anything());
  });

  it('deletes the cloud copy first when asked to', async () => {
    const { sync, crypto, bridge } = load();
    readyBridge(bridge);
    await sync.createSync(crypto.newRecoveryKey().secret, 'me@example.com');
    await sync.deleteCloudCopy();
    expect(mockApi).toHaveBeenCalledWith('sync/reset', { body: {} });
    expect(sync.getSyncStatus().phase).toBe('off');
  });

  it('stays set up if the cloud copy could not be deleted', async () => {
    const { sync, crypto, bridge, api } = load();
    readyBridge(bridge);
    await sync.createSync(crypto.newRecoveryKey().secret, 'me@example.com');
    mockApi.mockRejectedValueOnce(new api.ApiError(0, 'offline', 'offline'));
    await expect(sync.deleteCloudCopy()).rejects.toBeDefined();
    expect(secure.has('quo.sync.key')).toBe(true);
  });
});

describe('deleting the account', () => {
  it('deletes it on the server, then signs out and turns sync off here', async () => {
    const { sync, crypto, bridge } = load();
    readyBridge(bridge);
    secure.set('quo.sync.token', 'tok');
    await sync.createSync(crypto.newRecoveryKey().secret, 'me@example.com');
    await sync.deleteAccount();
    expect(mockApi).toHaveBeenCalledWith('account/delete', { body: { confirm: true } });
    expect(secure.has('quo.sync.token')).toBe(false);
    expect(secure.has('quo.sync.key')).toBe(false);
    expect(sync.getSyncStatus().phase).toBe('off');
  });

  it('changes nothing if the server refuses, for instance while a plan is running', async () => {
    const { sync, crypto, bridge, api } = load();
    readyBridge(bridge);
    secure.set('quo.sync.token', 'tok');
    await sync.createSync(crypto.newRecoveryKey().secret, 'me@example.com');
    mockApi.mockImplementation(async (path: string) => {
      if (path === 'account/delete') throw new api.ApiError(409, 'plan_active', 'Cancel your plan first.');
      return {};
    });
    await expect(sync.deleteAccount()).rejects.toMatchObject({ code: 'plan_active' });
    expect(secure.get('quo.sync.token')).toBe('tok');
    expect(secure.has('quo.sync.key')).toBe(true);
  });
});

describe('when syncing runs', () => {
  async function turnedOn() {
    const modules = load();
    const mine = modules.crypto.newRecoveryKey();
    const verifier = modules.crypto.makeVerifier(modules.crypto.deriveKey(mine.secret));
    mockStatus.mockResolvedValue({ enabled: true, verifier });
    return { ...modules, verifier };
  }

  it('waits while a reply is being written, then tries again', async () => {
    const { sync, crypto, bridge } = await turnedOn();
    const state = { busy: true };
    bridge.registerChatBridge({ getAll: () => [], apply: () => true, remove: () => true, flush: async () => {}, busy: () => state.busy });
    await sync.createSync(crypto.newRecoveryKey().secret, 'me@example.com');
    await tick();
    mockStatus.mockClear();
    await sync.syncNow();
    expect(mockStatus).not.toHaveBeenCalled();
    state.busy = false;
    await jest.advanceTimersByTimeAsync(3_100);
    await tick();
    expect(mockStatus).toHaveBeenCalled();
  });

  it('does not run in the background', async () => {
    const { sync, crypto, bridge } = await turnedOn();
    readyBridge(bridge);
    await sync.createSync(crypto.newRecoveryKey().secret, 'me@example.com');
    await tick();
    mockStatus.mockClear();
    mockAppState = 'background';
    await sync.syncNow();
    expect(mockStatus).not.toHaveBeenCalled();
  });

  it('writes pending edits first', async () => {
    const { sync, crypto, bridge } = await turnedOn();
    const { flush } = readyBridge(bridge);
    await sync.createSync(crypto.newRecoveryKey().secret, 'me@example.com');
    await tick(); await tick();
    expect(flush).toHaveBeenCalled();
  });

  it('shows a problem that needs the user, and stops retrying until they act', async () => {
    const { sync, crypto, bridge, api } = await turnedOn();
    readyBridge(bridge);
    mockStatus.mockRejectedValue(new api.ApiError(402, 'sync_required', 'Quo Sync is part of a plan.'));
    await sync.createSync(crypto.newRecoveryKey().secret, 'me@example.com');
    await tick(); await tick();
    expect(sync.getSyncStatus()).toMatchObject({ phase: 'error', error: { code: 'sync_required' } });
    mockStatus.mockClear();
    await sync.syncNow();
    expect(mockStatus).not.toHaveBeenCalled(); // blocked
    mockStatus.mockResolvedValue({ enabled: true, verifier: null });
    await sync.syncNow({ manual: true });
    expect(mockStatus).toHaveBeenCalled();
  });

  it('reports being offline calmly, and tries again on its own', async () => {
    const { sync, crypto, bridge, api } = await turnedOn();
    readyBridge(bridge);
    mockStatus.mockRejectedValueOnce(new api.ApiError(0, 'offline', 'offline'));
    await sync.createSync(crypto.newRecoveryKey().secret, 'me@example.com');
    await tick(); await tick();
    expect(sync.getSyncStatus()).toMatchObject({ phase: 'error', error: { code: 'offline' } });
    mockStatus.mockResolvedValue({ enabled: true, verifier: null });
    await sync.syncNow(); // offline isn't blocking
    expect(mockStatus).toHaveBeenCalledTimes(2);
  });

  it('says what went wrong when the cloud copy was deleted or the key changed', async () => {
    const { sync, crypto, bridge } = await turnedOn();
    readyBridge(bridge);
    mockStatus.mockResolvedValue({ enabled: false, verifier: null });
    await sync.createSync(crypto.newRecoveryKey().secret, 'me@example.com');
    await tick(); await tick();
    expect(sync.getSyncStatus().error).toMatchObject({ code: 'cloud_reset' });
    expect(sync.getSyncStatus().error!.message).toMatch(/turn quo sync off/i);
  });
});
