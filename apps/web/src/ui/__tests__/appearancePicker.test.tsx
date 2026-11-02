import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { installLocalStorage } from '../../providers/__tests__/helpers';

installLocalStorage();

async function picker(saved: Record<string, string>, says: { phone?: boolean; contrast?: boolean; dark?: boolean } = {}) {
  localStorage.clear();
  for (const [key, value] of Object.entries(saved)) localStorage.setItem(key, value);
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: (q.includes('pointer: coarse') && Boolean(says.phone)) || (q.includes('prefers-contrast') && Boolean(says.contrast)) || (q.includes('prefers-color-scheme: dark') && Boolean(says.dark)), addEventListener: () => {} }));
  vi.resetModules();
  const { AppearancePicker } = await import('../AppearancePicker');
  return renderToStaticMarkup(createElement(AppearancePicker));
}

describe('Settings → Appearance', () => {
  it('offers Black only where it can apply, and says when it will', async () => {
    expect(await picker({ 'quo.theme': 'light' })).not.toContain('Black background');
    expect(await picker({ 'quo.theme': 'dark' })).toContain('Black background');
    expect(await picker({})).toContain('Takes effect when your device is in dark mode.');
    expect(await picker({}, { dark: true })).not.toContain('Takes effect when');
  });

  it('says when a switch is overridden: E-ink over High contrast, High contrast over Black', async () => {
    const eink = await picker({ 'quo.theme': 'dark', 'quo.theme.eink': 'on' });
    expect(eink.match(/E-ink is on, so this has no effect now\./g)).toHaveLength(2);
    expect(eink).toContain('In use: E-ink');
    const contrast = await picker({ 'quo.theme': 'dark', 'quo.theme.contrast': 'on', 'quo.theme.black': 'on' });
    expect(contrast).toContain('High contrast is on, and it has its own dark.');
    expect(contrast).toContain('In use: High contrast dark');
  });

  it('offers the mode and three switches, each saying what automatic chose and why', async () => {
    const page = await picker({});
    for (const text of ['Auto', 'Light', 'Dark', 'Black background', 'High contrast', 'E-ink', 'In use: Light']) expect(page).toContain(text);
    expect(page).toContain('Automatic: off on computers');
    expect(page).not.toContain('Use automatic');
  });

  it('turns Black on for a phone, and follows the device’s contrast setting', async () => {
    const page = await picker({}, { phone: true, contrast: true });
    expect(page).toContain('Automatic: on, because this is a phone');
    expect(page).toContain('Automatic: on, from your device’s contrast setting');
    expect(page.match(/role="switch" aria-checked="true"/g)).toHaveLength(2);
  });

  it('shows a choice the person made, with the way back to automatic', async () => {
    const page = await picker({ 'quo.theme.eink': 'on' });
    expect(page).toContain('Set by you.');
    expect(page).toContain('Use automatic');
  });
});
