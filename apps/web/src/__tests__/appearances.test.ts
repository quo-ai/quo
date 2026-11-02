import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APPEARANCES, APPEARANCE_NAMES, contrast, groundOf, pairs, tokensCss } from '../styles/appearances';

const styles = new URL('../styles/', import.meta.url);

describe('the appearances', () => {
  it('each define the same colour roles, so a component reads the same names in every one', () => {
    const roles = Object.keys(APPEARANCES.light.colors).sort();
    for (const name of APPEARANCE_NAMES) expect(Object.keys(APPEARANCES[name].colors).sort(), name).toEqual(roles);
  });

  it('pass contrast on every pair: AA for text, 3:1 for edges and focus, AAA for text in High contrast and E-ink', () => {
    for (const name of APPEARANCE_NAMES) {
      const colors = APPEARANCES[name].colors;
      for (const { fg, bg, min } of pairs(name)) expect(contrast(colors[fg], colors[bg]), `${fg} on ${bg} in ${name}`).toBeGreaterThanOrEqual(min);
    }
  });

  it('are what styles/tokens.css and the website’s copy say (run `npm run tokens` after changing appearances.ts)', () => {
    expect(readFileSync(new URL('tokens.css', styles), 'utf8')).toBe(tokensCss());
    expect(readFileSync(new URL('../../../../website/assets/tokens.css', import.meta.url), 'utf8')).toBe(tokensCss());
  });

  it('are the only place a colour is written: the stylesheets use roles', () => {
    for (const file of readdirSync(styles).filter(name => name.endsWith('.css') && name !== 'tokens.css')) {
      const css = readFileSync(new URL(file, styles), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(css.match(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|light-dark\(/gi), file).toBeNull();
    }
  });

  it('match the colour the desktop window paints behind the page while it loads', () => {
    const theme = readFileSync(new URL('../../../desktop/src/theme.js', import.meta.url), 'utf8');
    for (const name of APPEARANCE_NAMES) expect(theme, name).toContain(`'${name}': '${groundOf(name)}'`);
  });
});

describe('the roles in use', () => {
  it('are all defined: no stylesheet or component asks for a colour, size or timing that doesn’t exist', () => {
    const read = (dir: URL, test: (name: string) => boolean): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
      entry.isDirectory() ? (entry.name === '__tests__' ? [] : read(new URL(`${entry.name}/`, dir), test)) : test(entry.name) ? [readFileSync(new URL(entry.name, dir), 'utf8')] : []);
    const src = new URL('../', import.meta.url);
    const css = read(styles, name => name.endsWith('.css'));
    const code = read(src, name => /\.tsx?$/.test(name));
    const defined = new Set([...css, ...code].flatMap(text => [...text.matchAll(/['"]?(--[\w-]+)['"]?\s*:/g)].map(m => m[1])));
    const used = new Set([...css, ...code].flatMap(text => [...text.matchAll(/var\((--[\w-]+)/g)].map(m => m[1])));
    // A name ending in a dash is a template's prefix (`var(--syn-${role})` in code/theme.ts), checked by its own test.
    expect([...used].filter(name => !name.endsWith('-') && !defined.has(name))).toEqual([]);
  });
});
