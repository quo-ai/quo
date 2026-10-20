import { describe, expect, it, vi } from 'vitest';
import { installLocalStorage } from '../providers/__tests__/helpers';

installLocalStorage();

/** A stand-in <html> element and window (the tests run without a browser), and the desktop bridge when asked for. */
function page(desktop = false) {
  const dataset: Record<string, string> = {};
  const sent: string[][] = [];
  vi.stubGlobal('document', { documentElement: { dataset } });
  vi.stubGlobal('window', desktop ? { quoDesktop: { appearance: { set: async (...args: string[]) => { sent.push(args); return { ok: true }; } } } } : {});
  return { dataset, sent };
}

async function fresh() {
  vi.resetModules();
  return import('../theme');
}

describe('the appearance setting', () => {
  it('follows the system, in Black and Indigo, until someone chooses, and puts no attribute on the page for the defaults', async () => {
    localStorage.clear();
    const { dataset } = page();
    const theme = await fresh();
    expect(theme.appearance()).toEqual({ mode: 'system', dark: 'black', accent: 'indigo' });
    theme.applyAppearance();
    expect(dataset).toEqual({});
  });

  it('puts each choice on the page, keeps it across a reload, and takes the attribute away again for a default', async () => {
    localStorage.clear();
    const { dataset } = page();
    const theme = await fresh();
    theme.setAppearance({ mode: 'dark' });
    theme.setAppearance({ dark: 'midnight', accent: 'mono' });
    expect(dataset).toEqual({ theme: 'dark', dark: 'midnight', accent: 'mono' });
    const again = await fresh();
    expect(again.appearance()).toEqual({ mode: 'dark', dark: 'midnight', accent: 'mono' });
    again.setAppearance({ mode: 'system', dark: 'black', accent: 'indigo' });
    expect(dataset).toEqual({});
  });

  it('keeps a choice made before the dark style and accent existed', async () => {
    localStorage.clear();
    localStorage.setItem('quo.theme', 'light');
    page();
    expect((await fresh()).appearance()).toEqual({ mode: 'light', dark: 'black', accent: 'indigo' });
  });

  it('ignores anything that is not one of the choices', async () => {
    localStorage.clear();
    localStorage.setItem('quo.theme', 'neon');
    localStorage.setItem('quo.theme.accent', 'red');
    const { dataset } = page();
    const theme = await fresh();
    expect(theme.appearance()).toEqual({ mode: 'system', dark: 'black', accent: 'indigo' });
    theme.setAppearance({ mode: 'neon', dark: 'grey', accent: 'mono' } as never);
    expect(theme.appearance()).toEqual({ mode: 'system', dark: 'black', accent: 'mono' });
    expect(dataset).toEqual({ accent: 'mono' });
  });

  it('tells the desktop app the scheme and the dark style, so its windows follow', async () => {
    localStorage.clear();
    const { sent } = page(true);
    const theme = await fresh();
    theme.setAppearance({ mode: 'light' });
    theme.setAppearance({ dark: 'midnight' });
    expect(sent).toEqual([['light', 'black'], ['light', 'midnight']]);
  });

  it('dissolves the new look in where the browser can, keeps two quick choices, and changes at once when motion is reduced', async () => {
    localStorage.clear();
    const dataset: Record<string, string> = {};
    const pending: (() => void)[] = [];
    let reduced = false;
    vi.stubGlobal('document', { documentElement: { dataset }, startViewTransition: (change: () => void) => { pending.push(change); } });
    vi.stubGlobal('window', {});
    vi.stubGlobal('matchMedia', () => ({ matches: reduced }));
    const theme = await fresh();
    theme.setAppearance({ dark: 'midnight' });
    theme.setAppearance({ accent: 'mono' });
    expect(theme.appearance()).toEqual({ mode: 'system', dark: 'midnight', accent: 'mono' });
    expect(dataset).toEqual({});
    pending.forEach(change => change());
    expect(dataset).toEqual({ dark: 'midnight', accent: 'mono' });
    reduced = true;
    theme.setAppearance({ accent: 'indigo' });
    expect(pending).toHaveLength(2);
    expect(dataset).toEqual({ dark: 'midnight' });
  });
});
