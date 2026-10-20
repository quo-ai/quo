import { describe, expect, it, vi } from 'vitest';
import { installLocalStorage } from '../providers/__tests__/helpers';

installLocalStorage();

/** A stand-in <html> element and window (the tests run without a browser), and the desktop bridge when asked for. */
function page(desktop = false) {
  const dataset: Record<string, string> = {};
  const sent: string[] = [];
  vi.stubGlobal('document', { documentElement: { dataset } });
  vi.stubGlobal('window', desktop ? { quoDesktop: { appearance: { set: async (mode: string) => { sent.push(mode); return { ok: true }; } } } } : {});
  return { dataset, sent };
}

async function fresh() {
  vi.resetModules();
  return import('../theme');
}

describe('the appearance setting', () => {
  it('follows the system until someone chooses, and puts no attribute on the page for it', async () => {
    localStorage.clear();
    const { dataset } = page();
    const theme = await fresh();
    expect(theme.themeMode()).toBe('system');
    theme.applyTheme();
    expect(dataset.theme).toBeUndefined();
  });

  it('puts the choice on the page, keeps it across a reload, and goes back to the system when asked', async () => {
    localStorage.clear();
    const { dataset } = page();
    const theme = await fresh();
    theme.setThemeMode('dark');
    expect(dataset.theme).toBe('dark');
    const again = await fresh();
    expect(again.themeMode()).toBe('dark');
    again.setThemeMode('system');
    expect(dataset.theme).toBeUndefined();
  });

  it('ignores anything that is not one of the three', async () => {
    localStorage.clear();
    localStorage.setItem('quo.theme', 'neon');
    page();
    const theme = await fresh();
    expect(theme.themeMode()).toBe('system');
    theme.setThemeMode('neon' as never);
    expect(theme.themeMode()).toBe('system');
  });

  it('tells the desktop app, so its own windows follow', async () => {
    localStorage.clear();
    const { sent } = page(true);
    const theme = await fresh();
    theme.setThemeMode('light');
    theme.applyTheme();
    expect(sent).toEqual(['light', 'light']);
  });
});
