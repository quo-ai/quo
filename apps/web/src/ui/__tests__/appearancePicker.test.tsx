import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { installLocalStorage } from '../../providers/__tests__/helpers';

installLocalStorage();

async function picker(mode: string | null) {
  localStorage.clear();
  if (mode) localStorage.setItem('quo.theme', mode);
  vi.resetModules();
  const { AppearancePicker } = await import('../AppearancePicker');
  return renderToStaticMarkup(createElement(AppearancePicker));
}

describe('Settings → Appearance', () => {
  it('offers the dark style only where it applies: Dark, and System (dark when the computer is), not Light', async () => {
    expect(await picker('light')).not.toContain('Dark style');
    expect(await picker('dark')).toContain('Dark style');
    expect(await picker(null)).toContain('Dark style');
    for (const mode of ['light', 'dark', null]) {
      const page = await picker(mode);
      expect(page).toContain('Mode');
      expect(page).toContain('Accent');
    }
  });
});

describe('the dissolve', () => {
  const css = readFileSync(new URL('../../styles/crt.css', import.meta.url), 'utf8');
  const cells = (level: number) => {
    const path = new RegExp(`--dither-${level}: url\\("[^"]*d='([^']*)'`).exec(css)![1];
    return [...path.matchAll(/M(\d+)%20(\d+)h(\d+)/g)].reduce((sum, m) => sum + Number(m[3]) / 2, 0);
  };

  it('fills an ordered 4x4 dither through all 16 levels, one 2px cell more each frame', () => {
    for (let level = 1; level <= 15; level++) expect(cells(level), `level ${level}`).toBe(level);
    const frames = css.slice(css.indexOf('@keyframes dissolve'), css.indexOf('}\n}', css.indexOf('@keyframes dissolve')));
    expect(frames.match(/var\(--dither-\d+\)/g)?.length).toBe(30); // 15 levels, -webkit- and standard
  });

  it('moves the working bar one dither cell a step, and every animation still stops for reduced motion', () => {
    expect(css).not.toMatch(/steps\(16\) infinite/);
    expect(css.match(/dither-run [\d.]+s steps\(32\) infinite/g)?.length).toBe(2);
    const responsive = readFileSync(new URL('../../styles/responsive.css', import.meta.url), 'utf8');
    expect(responsive).toMatch(/prefers-reduced-motion: reduce/);
  });
});
