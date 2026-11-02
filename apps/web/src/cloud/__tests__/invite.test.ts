import { beforeEach, expect, it, vi } from 'vitest';
import { installLocalStorage } from '../../providers/__tests__/helpers';
import { forgetInvite, pendingInvite, rememberInvite } from '../invite';

installLocalStorage();
let address = '';
vi.stubGlobal('history', { state: null, replaceState: (_state: unknown, _title: string, url: string) => void (address = url) });
const at = (url: string) => {
  const parsed = new URL(url, 'https://app.quo.computer');
  return { pathname: parsed.pathname, search: parsed.search, hash: parsed.hash };
};

beforeEach(() => {
  localStorage.clear();
  address = '';
});

it('keeps a valid invite code until sign-in, and takes it out of the address bar straight away', () => {
  rememberInvite(at('/?ref=abcd2345&model=x#top'));
  expect(pendingInvite()).toBe('abcd2345');
  expect(address).toBe('/?model=x#top');
  forgetInvite();
  expect(pendingInvite()).toBeUndefined();
});

it('drops anything that isn’t an invite code, and leaves an address without one alone', () => {
  rememberInvite(at('/?ref=<script>alert(1)</script>'));
  expect(pendingInvite()).toBeUndefined();
  expect(address).toBe('/');
  address = 'untouched';
  rememberInvite(at('/?checkout=success'));
  expect(address).toBe('untouched');
});
