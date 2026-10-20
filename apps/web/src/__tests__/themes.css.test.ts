import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** The colour tokens of styles/base.css and styles/themes.css, read as text: a block's declarations by name. */
const css = (file: string) => readFileSync(new URL(`../styles/${file}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const block = (text: string, selector: string) => {
  const start = text.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const body = text.slice(text.indexOf('{', start) + 1, text.indexOf('\n}', start));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));
};
/** The light and dark halves of light-dark(a, b), or the same value twice. */
function halves(value: string): [string, string] {
  const inner = /^light-dark\(([\s\S]*)\)$/.exec(value)?.[1];
  if (!inner) return [value, value];
  let depth = 0;
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === '(') depth++;
    else if (inner[i] === ')') depth--;
    else if (inner[i] === ',' && depth === 0) return [inner.slice(0, i).trim(), inner.slice(i + 1).trim()];
  }
  throw new Error(`not a pair: ${value}`);
}

/** WCAG contrast of two opaque colours, and an rgba() laid over a colour. */
const rgb = (color: string): number[] => {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (hex) return [0, 2, 4].map(i => parseInt(hex[1].slice(i, i + 2), 16));
  const parts = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(color);
  if (!parts) throw new Error(`not a colour: ${color}`);
  return parts.slice(1, 4).map(Number);
};
const over = (color: string, under: string) => {
  const alpha = Number(/, ([\d.]+)\)$/.exec(color)?.[1] ?? 1);
  return rgb(color).map((c, i) => Math.round(c * alpha + rgb(under)[i] * (1 - alpha)));
};
const luminance = (c: number[]) => c.map(v => v / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a: number[], b: number[]) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const base = block(css('base.css'), ':root');
const themes = css('themes.css');
const midnight = block(themes, ':root[data-dark="midnight"]');
const mono = block(themes, ':root[data-accent="mono"]');

describe('the appearance tokens', () => {
  it('change only the dark look in Midnight: every light value is the same as the default', () => {
    for (const [name, value] of Object.entries(midnight)) expect(halves(value)[0], name).toBe(halves(base[name])[0]);
  });

  it('keep every text colour AA in the dark, on the page, the thickest glass and a raised control, in Black and Midnight', () => {
    for (const style of [base, { ...base, ...midnight }]) {
      const bg = halves(style['--bg'])[1];
      const glass = over(halves(style['--glass-thick'])[1], bg);
      const raised = rgb(halves(style['--raised'])[1]);
      for (const name of ['--text', '--text-2', '--text-3', '--indigo', '--error', '--warn', '--success']) {
        const text = rgb(halves(style[name])[1]);
        for (const under of [rgb(bg), glass, raised]) expect(contrast(text, under), `${name} in ${style['--bg']}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('put readable text on brand fills, in both accents and both schemes', () => {
    for (const accent of [base, { ...base, ...mono }]) {
      for (const side of [0, 1] as const) {
        const on = rgb(halves(accent['--on-brand'])[side]);
        expect(contrast(on, rgb(halves(accent['--brand'])[side]))).toBeGreaterThanOrEqual(4.5);
        expect(contrast(on, rgb(halves(accent['--brand-2'])[side]))).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keep Mono’s accent as text AA on the page in both schemes', () => {
    const themed = { ...base, ...mono };
    for (const side of [0, 1] as const) expect(contrast(rgb(halves(themed['--indigo'])[side]), rgb(halves(themed['--bg'])[side]))).toBeGreaterThanOrEqual(4.5);
  });
});
