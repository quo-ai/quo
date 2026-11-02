import { describe, expect, it, vi } from 'vitest';
import { installLocalStorage } from '../providers/__tests__/helpers';

installLocalStorage();

/** What the device says: dark mode, more contrast, an e-ink screen, a phone (touch, no hover), reduced motion. */
function device(says: { dark?: boolean; contrast?: boolean; eink?: boolean; phone?: boolean; calm?: boolean } = {}) {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: (q.includes('prefers-color-scheme: dark') && Boolean(says.dark)) || (q.includes('prefers-contrast') && Boolean(says.contrast))
      || (q.includes('update: slow') && Boolean(says.eink)) || (q.includes('pointer: coarse') && Boolean(says.phone)) || (q.includes('reduced-motion') && Boolean(says.calm)),
    addEventListener: () => {},
  }));
}

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
  it('is automatic until someone chooses: Light on a computer in light mode, Dark in dark mode', async () => {
    localStorage.clear();
    device();
    const { dataset } = page();
    let theme = await fresh();
    expect(theme.appearance()).toEqual({ mode: 'system', black: 'auto', contrast: 'auto', eink: 'auto' });
    theme.applyAppearance();
    expect(dataset.env).toBe('light');
    device({ dark: true });
    theme = await fresh();
    theme.applyAppearance();
    expect(dataset.env).toBe('dark');
  });

  it('gives a phone Black in dark mode, and the device decides High contrast and E-ink', async () => {
    localStorage.clear();
    page();
    device({ dark: true, phone: true });
    expect((await fresh()).resolve((await fresh()).appearance())).toBe('black');
    device({ dark: true, contrast: true });
    expect((await fresh()).resolve((await fresh()).appearance())).toBe('contrast-dark');
    device({ contrast: true });
    expect((await fresh()).resolve((await fresh()).appearance())).toBe('contrast');
    device({ eink: true, dark: true, contrast: true });
    expect((await fresh()).resolve((await fresh()).appearance())).toBe('eink');
  });

  it('counts the desktop app as a computer, even on a touch screen', async () => {
    localStorage.clear();
    page(true);
    device({ dark: true, phone: true });
    const theme = await fresh();
    expect(theme.resolve(theme.appearance())).toBe('dark');
  });

  it('keeps a switch the person set, and goes back to automatic when asked', async () => {
    localStorage.clear();
    device({ dark: true });
    const { dataset } = page();
    const theme = await fresh();
    theme.setAppearance({ black: 'on' });
    expect(dataset.env).toBe('black');
    const again = await fresh();
    expect(again.appearance().black).toBe('on');
    again.setAppearance({ black: 'auto' });
    expect(localStorage.getItem('quo.theme.black')).toBeNull();
    expect(dataset.env).toBe('dark');
    again.setAppearance({ mode: 'light', contrast: 'on' });
    expect(dataset.env).toBe('contrast');
  });

  it('carries over the earlier choices: the mode, and a dark style chosen by hand (Midnight is now Dark)', async () => {
    localStorage.clear();
    device({ dark: true, phone: true });
    page();
    localStorage.setItem('quo.theme', 'dark');
    localStorage.setItem('quo.theme.dark', 'midnight');
    localStorage.setItem('quo.theme.accent', 'mono');
    let theme = await fresh();
    expect(theme.appearance()).toEqual({ mode: 'dark', black: 'off', contrast: 'auto', eink: 'auto' });
    expect(theme.resolve(theme.appearance())).toBe('dark');
    localStorage.setItem('quo.theme.dark', 'black');
    theme = await fresh();
    expect(theme.appearance().black).toBe('on');
  });

  it('ignores anything that is not one of the choices', async () => {
    localStorage.clear();
    device();
    localStorage.setItem('quo.theme', 'neon');
    localStorage.setItem('quo.theme.contrast', 'maybe');
    page();
    const theme = await fresh();
    expect(theme.appearance()).toEqual({ mode: 'system', black: 'auto', contrast: 'auto', eink: 'auto' });
    theme.setAppearance({ mode: 'neon', eink: 'yes' } as never);
    expect(theme.appearance()).toEqual({ mode: 'system', black: 'auto', contrast: 'auto', eink: 'auto' });
  });

  it('tells the desktop app the mode and the appearance, so its windows follow', async () => {
    localStorage.clear();
    device();
    const { sent } = page(true);
    const theme = await fresh();
    theme.setAppearance({ mode: 'dark' });
    theme.setAppearance({ contrast: 'on' });
    expect(sent).toEqual([['dark', 'dark'], ['dark', 'contrast-dark']]);
  });

  it('cross-fades the new look where the browser can, and changes at once when motion is reduced', async () => {
    localStorage.clear();
    const dataset: Record<string, string> = {};
    const pending: (() => void)[] = [];
    vi.stubGlobal('document', { documentElement: { dataset }, startViewTransition: (change: () => void) => { pending.push(change); } });
    vi.stubGlobal('window', {});
    device();
    const theme = await fresh();
    theme.setAppearance({ mode: 'dark' });
    expect(dataset.env).toBeUndefined();
    pending.forEach(change => change());
    expect(dataset.env).toBe('dark');
    device({ calm: true });
    theme.setAppearance({ mode: 'light' });
    expect(pending).toHaveLength(1);
    expect(dataset.env).toBe('light');
  });
});
