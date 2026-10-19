import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account } from '../../cloud/account';

const state = vi.hoisted(() => ({ sync: { phase: 'off', error: null } as { phase: string; error: { code: string } | null }, bridge: false }));

vi.mock('../../sync', () => ({ useSyncStatus: () => state.sync }));
vi.mock('../../memory/store', () => ({ listMemories: async () => [], onMemoriesChanged: () => () => {} }));
vi.mock('../../native', () => ({ agentBridge: () => (state.bridge ? {} : null) }));

const { SettingsSheet } = await import('../SettingsSheet');

const signedOut = { user: null, plan: 'free', credits: null } as unknown as Account;
const signedIn = { user: { email: 'pat' + '@example.test' }, plan: 'free', credits: 1234 } as unknown as Account;
const pro = { user: { email: 'pat' + '@example.test' }, plan: 'pro', credits: 90 } as unknown as Account;

const html = (account: Account | null, extra: { installedCount?: number; hasCloud?: boolean } = {}) =>
  renderToStaticMarkup(createElement(SettingsSheet, { account, installedCount: extra.installedCount ?? 0, hasCloud: extra.hasCloud ?? true, onOpen: () => {}, onClose: () => {} }));

describe('Settings', () => {
  beforeEach(() => {
    state.sync = { phase: 'off', error: null };
    state.bridge = false;
  });

  it('is there for someone who is not signed in, with everything that does not need an account', () => {
    const page = html(signedOut);
    for (const text of ['Memories', 'Quo Sync', 'Offline models and storage', 'Your own API keys', 'Web search', 'Get the app']) expect(page).toContain(text);
    expect(page).toContain('Sign in');
    expect(page).toContain('Quo works without it');
    expect(page).toContain('Quo Pro');
  });

  it('is there when the Quo service cannot be reached, without account rows', () => {
    const page = html(null, { hasCloud: false });
    expect(page).toContain('Memories');
    expect(page).toContain('Your own API keys');
    expect(page).not.toContain('Sign in');
    expect(page).not.toContain('Quo Pro');
    expect(page).not.toContain('Cloud models');
  });

  it('shows the account, credits and plan for someone signed in', () => {
    const page = html(signedIn);
    expect(page).toContain('pat' + '@example.test');
    expect(page).toContain('1,234 credits');
    expect(page).not.toContain('>Sign in<');
    expect(page).toContain('Quo Pro');
    const proPage = html(pro);
    expect(proPage).toContain('Pro</span>');
    expect(proPage).not.toContain('What it adds');
  });

  it('counts offline models and shows what sync is doing', () => {
    expect(html(signedOut, { installedCount: 2 })).toContain('2 on device');
    state.sync = { phase: 'error', error: { code: 'server' } };
    expect(html(signedOut)).toContain('Needs attention');
    state.sync = { phase: 'error', error: { code: 'offline' } };
    expect(html(signedOut)).toContain('>Offline<');
  });

  it('offers Code mode only in the desktop app', () => {
    expect(html(signedOut)).not.toContain('Code mode');
    state.bridge = true;
    expect(html(signedOut)).toContain('Code mode');
  });
});
