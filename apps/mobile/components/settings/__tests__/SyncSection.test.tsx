import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import type { SyncStatus } from '@/services/sync';
import { SyncSection, timeAgo } from '../SyncSection';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockState = {
  status: { phase: 'off', email: null, lastSyncAt: null, error: null, skipped: 0, tooLarge: 0 } as SyncStatus,
  signedIn: false,
  account: null as { email: string; entitled: boolean } | null,
  cloud: { entitled: true, enabled: false, usedBytes: 0, limitBytes: 250_000_000, records: 0 } as { entitled: boolean; enabled: boolean; usedBytes: number; limitBytes: number; records: number } | Error,
};
const mockSync = {
  createSync: jest.fn(async () => {}),
  deleteCloudCopy: jest.fn(async () => {}),
  deleteAccount: jest.fn(async () => {}),
  disableSync: jest.fn(async () => {}),
  joinSync: jest.fn(async () => {}),
  refreshAccount: jest.fn(async () => mockState.account),
  signOut: jest.fn(async () => {}),
  startSignIn: jest.fn(async () => ({})),
  syncNow: jest.fn(async () => {}),
  verifySignIn: jest.fn(async () => {}),
};

jest.mock('@/services/sync', () => ({
  JoinError: class JoinError extends Error { code = ''; },
  createSync: (...a: unknown[]) => (mockSync.createSync as (...x: unknown[]) => unknown)(...a),
  deleteAccount: () => mockSync.deleteAccount(),
  deleteCloudCopy: () => mockSync.deleteCloudCopy(),
  disableSync: () => mockSync.disableSync(),
  joinSync: (...a: unknown[]) => (mockSync.joinSync as (...x: unknown[]) => unknown)(...a),
  refreshAccount: () => mockSync.refreshAccount(),
  signOut: () => mockSync.signOut(),
  startSignIn: (...a: unknown[]) => (mockSync.startSignIn as (...x: unknown[]) => unknown)(...a),
  syncNow: (...a: unknown[]) => (mockSync.syncNow as (...x: unknown[]) => unknown)(...a),
  verifySignIn: (...a: unknown[]) => (mockSync.verifySignIn as (...x: unknown[]) => unknown)(...a),
  getCloudStatus: async () => { if (mockState.cloud instanceof Error) throw mockState.cloud; return mockState.cloud; },
  useSyncStatus: () => mockState.status,
  useSyncAccount: () => ({ account: mockState.account, signedIn: mockState.signedIn }),
}));
// Icons are just pictures; the library ships as ES modules Jest doesn't transform.
jest.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => (name === '__esModule' ? true : () => null) }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));

const contentOf = (node: TestRenderer.ReactTestInstance): string => node.children.map(child => (typeof child === 'string' ? child : contentOf(child))).join('');
const text = (renderer: TestRenderer.ReactTestRenderer): string => contentOf(renderer.root);
const buttonLabelled = (renderer: TestRenderer.ReactTestRenderer, label: string) =>
  renderer.root.findAll(node => node.props.accessibilityRole === 'button' && contentOf(node).includes(label))[0];

async function openSheet(): Promise<TestRenderer.ReactTestRenderer> {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<SyncSection />);
  });
  const card = renderer.root.findByProps({ accessibilityLabel: 'Quo Sync' });
  await act(async () => { card.props.onPress(); });
  await act(async () => {});
  return renderer;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockState.status = { phase: 'off', email: null, lastSyncAt: null, error: null, skipped: 0, tooLarge: 0 };
  mockState.signedIn = false;
  mockState.account = null;
  mockState.cloud = { entitled: true, enabled: false, usedBytes: 0, limitBytes: 250_000_000, records: 0 };
});

describe('the Sync section in Settings', () => {
  it('says it is off, and what it is for', async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<SyncSection />); });
    expect(text(renderer)).toContain('Quo Sync');
    expect(text(renderer)).toContain('Off');
    expect(text(renderer)).toContain('Only you hold the key');
  });

  it('shows when it last synced, syncing, offline and needing attention', async () => {
    const show = async (status: Partial<SyncStatus>) => {
      mockState.status = { ...mockState.status, ...status } as SyncStatus;
      let renderer!: TestRenderer.ReactTestRenderer;
      await act(async () => { renderer = TestRenderer.create(<SyncSection />); });
      return text(renderer);
    };
    expect(await show({ phase: 'idle', lastSyncAt: Date.now() - 5 * 60_000 })).toContain('Up to date · 5 minutes ago');
    expect(await show({ phase: 'syncing' })).toContain('Syncing…');
    expect(await show({ phase: 'error', error: { code: 'offline', message: 'x' } })).toContain('Offline');
    expect(await show({ phase: 'error', error: { code: 'sync_required', message: 'x' } })).toContain('Needs attention');
  });
});

describe('the Sync sheet', () => {
  it('asks you to sign in first, and sends the code', async () => {
    const renderer = await openSheet();
    expect(text(renderer)).toContain('needs a Quo account');
    const email = renderer.root.findByProps({ accessibilityLabel: 'Email' });
    await act(async () => { email.props.onChangeText('me@example.com'); });
    const send = buttonLabelled(renderer, 'Email me a code');
    await act(async () => { send.props.onPress(); });
    expect(mockSync.startSignIn).toHaveBeenCalledWith('me@example.com');
    expect(text(renderer)).toContain('Enter the 6-digit code');
  });

  it('signs in as soon as the sixth digit is typed', async () => {
    const renderer = await openSheet();
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Email' }).props.onChangeText('me@example.com'); });
    const send = buttonLabelled(renderer, 'Email me a code');
    await act(async () => { send.props.onPress(); });
    const code = renderer.root.findByProps({ accessibilityLabel: 'Sign-in code' });
    await act(async () => { code.props.onChangeText('12a3456x'); });
    expect(mockSync.verifySignIn).toHaveBeenCalledWith('me@example.com', '123456');
  });

  it('shows a sign-in problem, such as the service not being set up yet', async () => {
    const { ApiError } = jest.requireActual('@/services/sync/api');
    mockSync.startSignIn.mockRejectedValueOnce(new ApiError(503, 'setup_required', 'Sign-in isn’t set up yet. It’s coming soon.'));
    const renderer = await openSheet();
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Email' }).props.onChangeText('me@example.com'); });
    const send = buttonLabelled(renderer, 'Email me a code');
    await act(async () => { send.props.onPress(); });
    expect(text(renderer)).toContain('Sign-in isn’t set up yet. It’s coming soon.');
  });

  it('explains when the account has no plan, without selling anything', async () => {
    mockState.signedIn = true;
    mockState.account = { email: 'me@example.com', entitled: false };
    mockState.cloud = { entitled: false, enabled: false, usedBytes: 0, limitBytes: 1, records: 0 };
    const renderer = await openSheet();
    expect(text(renderer)).toContain('included with a Quo Pro or Quo Sync plan');
    expect(text(renderer)).toContain('Check again');
    expect(text(renderer)).not.toMatch(/\$\d|buy|purchase|subscribe|https?:/i);
  });

  it('shows what is wrong when Quo Sync can’t be reached or isn’t set up', async () => {
    const { ApiError } = jest.requireActual('@/services/sync/api');
    mockState.signedIn = true;
    mockState.account = { email: 'me@example.com', entitled: true };
    mockState.cloud = new ApiError(503, 'setup_required', 'Quo Sync isn’t set up yet. It’s coming soon.');
    const renderer = await openSheet();
    expect(text(renderer)).toContain('Quo Sync isn’t set up yet. It’s coming soon.');
    expect(text(renderer)).toContain('Try again');
  });

  it('walks through getting the recovery key, and only turns on once it is confirmed saved', async () => {
    mockState.signedIn = true;
    mockState.account = { email: 'me@example.com', entitled: true };
    const renderer = await openSheet();
    expect(text(renderer)).toContain('recovery key');
    const press = async (label: string) => {
      const button = buttonLabelled(renderer, label);
      await act(async () => { button.props.onPress(); });
    };
    await press('Turn on Quo Sync');
    const key = renderer.root.findByProps({ accessibilityLabel: 'Recovery key' }).props.children as string;
    expect(key).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){8}[0-9A-HJKMNP-TV-Z]{2}$/);
    const turnOn = () => buttonLabelled(renderer, 'Turn on Quo Sync');
    expect(turnOn().props.disabled).toBe(true);
    await act(async () => { renderer.root.findByProps({ accessibilityRole: 'checkbox' }).props.onPress(); });
    expect(turnOn().props.disabled).toBe(false);
    await act(async () => { turnOn().props.onPress(); });
    expect(mockSync.createSync).toHaveBeenCalledWith(expect.any(Uint8Array), 'me@example.com');
  });

  it('lets you join with a recovery key when sync is already on for the account', async () => {
    mockState.signedIn = true;
    mockState.account = { email: 'me@example.com', entitled: true };
    mockState.cloud = { entitled: true, enabled: true, usedBytes: 0, limitBytes: 1, records: 0 };
    const renderer = await openSheet();
    expect(text(renderer)).toContain('already on for');
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Recovery key' }).props.onChangeText('abcd-efgh'); });
    const join = buttonLabelled(renderer, 'Join Quo Sync');
    await act(async () => { join.props.onPress(); });
    expect(mockSync.joinSync).toHaveBeenCalledWith('abcd-efgh', 'me@example.com');
  });

  it('shows the state and the ways out once connected', async () => {
    mockState.signedIn = true;
    mockState.account = { email: 'me@example.com', entitled: true };
    mockState.status = { phase: 'idle', email: 'me@example.com', lastSyncAt: Date.now(), error: null, skipped: 0, tooLarge: 2 };
    mockState.cloud = { entitled: true, enabled: true, usedBytes: 4_700_000, limitBytes: 250_000_000, records: 612 };
    const renderer = await openSheet();
    const all = text(renderer);
    expect(all).toContain('Up to date · just now');
    expect(all).toContain('4.7 MB of 250.0 MB');
    expect(all).toContain('612 items');
    expect(all).toContain('2 chats are too big to sync');
    expect(all).toContain('Turn off on this phone');
    expect(all).toContain('Delete the cloud copy…');
    const press = async (label: string) => {
      const button = buttonLabelled(renderer, label);
      await act(async () => { button.props.onPress(); });
    };
    await press('Sync now');
    expect(mockSync.syncNow).toHaveBeenCalledWith({ manual: true });
    await press('Delete the cloud copy…');
    expect(mockSync.deleteCloudCopy).not.toHaveBeenCalled(); // asks first
    expect(text(renderer)).toContain('Yes, delete the cloud copy');
    await press('Yes, delete the cloud copy');
    expect(mockSync.deleteCloudCopy).toHaveBeenCalled();
  });

  it('shows what is wrong, in words, when syncing needs attention', async () => {
    mockState.signedIn = true;
    mockState.status = { phase: 'error', email: 'me@example.com', lastSyncAt: null, error: { code: 'key_changed', message: 'The recovery key was changed on another device.' }, skipped: 0, tooLarge: 0 };
    const renderer = await openSheet();
    expect(text(renderer)).toContain('Needs attention');
    expect(text(renderer)).toContain('The recovery key was changed on another device.');
  });
});

describe('deleting the account', () => {
  async function signedInSheet() {
    mockState.signedIn = true;
    mockState.account = { email: 'me@example.com', entitled: true };
    return openSheet();
  }

  it('asks first, says what goes and what stays, and only then deletes', async () => {
    const renderer = await signedInSheet();
    await act(async () => { buttonLabelled(renderer, 'Delete my Quo account')!.props.onPress(); });
    expect(text(renderer)).toContain('Chats and memories on this phone stay');
    expect(mockSync.deleteAccount).not.toHaveBeenCalled();
    await act(async () => { buttonLabelled(renderer, 'Yes, delete my account')!.props.onPress(); });
    expect(mockSync.deleteAccount).toHaveBeenCalledTimes(1);
  });

  it('can be backed out of', async () => {
    const renderer = await signedInSheet();
    await act(async () => { buttonLabelled(renderer, 'Delete my Quo account')!.props.onPress(); });
    await act(async () => { buttonLabelled(renderer, 'Cancel')!.props.onPress(); });
    expect(text(renderer)).toContain('Delete my Quo account…');
    expect(mockSync.deleteAccount).not.toHaveBeenCalled();
  });

  it('shows the server’s reason when it can’t, such as a running plan', async () => {
    const { ApiError } = jest.requireActual('@/services/sync/api');
    mockSync.deleteAccount.mockRejectedValueOnce(new ApiError(409, 'plan_active', 'Cancel your plan first, then delete your account.'));
    const renderer = await signedInSheet();
    await act(async () => { buttonLabelled(renderer, 'Delete my Quo account')!.props.onPress(); });
    await act(async () => { buttonLabelled(renderer, 'Yes, delete my account')!.props.onPress(); });
    expect(text(renderer)).toContain('Cancel your plan first, then delete your account.');
  });

  it('is also there once connected', async () => {
    mockState.status = { phase: 'idle', email: 'me@example.com', lastSyncAt: Date.now(), error: null, skipped: 0, tooLarge: 0 };
    const renderer = await signedInSheet();
    expect(text(renderer)).toContain('Delete my Quo account…');
  });
});

describe('timeAgo', () => {
  it('speaks plainly', () => {
    const now = 1_000_000_000_000;
    expect(timeAgo(now - 10_000, now)).toBe('just now');
    expect(timeAgo(now - 90_000, now)).toBe('2 minutes ago');
    expect(timeAgo(now - 3_600_000, now)).toBe('1 hour ago');
    expect(timeAgo(now - 30 * 3_600_000, now)).toBe('yesterday');
    expect(timeAgo(now - 5 * 86_400_000, now)).toBe('5 days ago');
  });
});
