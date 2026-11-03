import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { LocalServer, hasLocalServer } from '../LocalServer';

afterEach(() => vi.unstubAllGlobals());

it('is offered only in a desktop app that has the local server', () => {
  vi.stubGlobal('window', {});
  expect(hasLocalServer()).toBe(false);
  expect(renderToStaticMarkup(createElement(LocalServer))).toBe('');
  vi.stubGlobal('window', { quoDesktop: { localServer: { state: async () => ({ ok: { on: false, port: 1235, address: 'http://127.0.0.1:1235/v1', key: 'quo-x' } }) } } });
  expect(hasLocalServer()).toBe(true);
});
