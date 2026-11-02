import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { installLocalStorage } from '../providers/__tests__/helpers';

installLocalStorage();

/** public/appearance.js, run as the page runs it before the first paint: it sets data-env on <html>. */
const source = readFileSync(new URL('../../public/appearance.js', import.meta.url), 'utf8');
function boot(media: (q: string) => boolean, desktop: boolean): string | null {
  let set: string | null = null;
  const document = { documentElement: { setAttribute: (_: string, value: string) => { set = value; } } };
  new Function('window', 'matchMedia', 'document', source)(desktop ? { quoDesktop: {} } : {}, (q: string) => ({ matches: media(q) }), document);
  return set;
}

describe('the appearance before the first paint (public/appearance.js)', () => {
  it('chooses exactly what theme.ts chooses, for every stored choice, device and kind of app', async () => {
    const theme = await import('../theme');
    const modes = [null, 'system', 'light', 'dark', 'neon'];
    const switches = [null, 'auto', 'on', 'off'];
    const styles = [null, 'black', 'midnight'];
    let checked = 0;
    for (const mode of modes) for (const black of switches) for (const contrast of switches) for (const eink of switches) for (const style of styles) {
      localStorage.clear();
      const stored = { 'quo.theme': mode, 'quo.theme.black': black, 'quo.theme.contrast': contrast, 'quo.theme.eink': eink, 'quo.theme.dark': style };
      for (const [key, value] of Object.entries(stored)) if (value !== null) localStorage.setItem(key, value);
      for (let flags = 0; flags < 32; flags++) {
        const says = { dark: Boolean(flags & 1), contrast: Boolean(flags & 2), eink: Boolean(flags & 4), phone: Boolean(flags & 8) };
        const desktop = Boolean(flags & 16);
        const media = (q: string) => (q.includes('prefers-color-scheme: dark') && says.dark) || (q.includes('prefers-contrast') && says.contrast) || (q.includes('update: slow') && says.eink) || (q.includes('pointer: coarse') && says.phone);
        vi.stubGlobal('matchMedia', (q: string) => ({ matches: media(q) }));
        vi.stubGlobal('window', desktop ? { quoDesktop: {} } : {});
        expect(boot(media, desktop), JSON.stringify({ stored, says, desktop })).toBe(theme.resolve(theme.readChoice(), theme.automatic()));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10_000);
  });
});
