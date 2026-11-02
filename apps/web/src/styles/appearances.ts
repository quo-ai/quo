/**
 * Quo's appearances: one set of colour roles each, in OKLCH [lightness, chroma, hue] or hex. This file is the source;
 * `node scripts/tokens.ts` writes styles/tokens.css from it, and appearances.test.ts checks every pair below for
 * contrast and that tokens.css is current. Hue 272 is Quo's indigo (#3B2EFF is OKLCH 0.496 0.284 271.7); the cool
 * neutrals lean toward it. Which appearance is used is decided in theme.ts (a mode and three switches).
 *
 * Roles
 *   ground       the page                 ground-2   chat list, panels       sheet     cards, sheets, the composer
 *   sheet-2      raised controls, hover   sunken     inputs, wells           scrim     behind a sheet
 *   ink          text                     ink-2      secondary text          ink-3     hints, facts (still AA)
 *   ink-off      disabled (no promise)    rule       hairlines               rule-strong  control edges (3:1)
 *   indigo       accent as text and icons indigo-fill  the one solid action  on-indigo    text on it
 *   indigo-wash  selected, the person's messages
 *   sky / sky-wash          the cloud: cloud models, web search
 *   danger / caution / add  problems, warnings, additions and "ready"
 *   you-*        the person's message     code-*, syn-*  code (syn roles are named by code/theme.ts)
 *   focus        focus ring               field / on-field / field-2  the indigo background of first run
 */

type Color = string | [number, number, number];
export type AppearanceName = 'light' | 'dark' | 'black' | 'contrast' | 'contrast-dark' | 'eink';
export interface Appearance {
  label: string;
  scheme: 'light' | 'dark';
  weights: { body: number; strong: number; head: number };
  /** Icon stroke and border width. */
  stroke: number;
  bw: string;
  shadow: string;
  colors: Record<string, Color>;
}

const H = 272;
const n = (L: number, C = 0.006, h = H): [number, number, number] => [L, C, h];

const light: Appearance = {
  label: 'Light',
  scheme: 'light',
  weights: { body: 400, strong: 650, head: 760 },
  stroke: 1.75, bw: '1px',
  shadow: '0 1px 1px rgb(20 18 60 / 0.05), 0 10px 28px -14px rgb(20 18 60 / 0.22)',
  colors: {
    ground: n(0.984, 0.004), 'ground-2': n(0.962, 0.007), sheet: n(0.998, 0.002), 'sheet-2': n(0.944, 0.009),
    sunken: n(0.968, 0.007), scrim: 'rgba(18, 16, 48, 0.36)',
    ink: n(0.2, 0.026, 276), 'ink-2': n(0.42, 0.024, 276), 'ink-3': n(0.505, 0.02, 276), 'ink-off': n(0.72, 0.012),
    rule: n(0.905, 0.012), 'rule-strong': n(0.6, 0.02),
    indigo: '#3b2eff', 'indigo-fill': '#3b2eff', 'on-indigo': n(0.995, 0.004), 'indigo-wash': n(0.94, 0.036, 276),
    sky: [0.5, 0.1, 228], 'sky-wash': [0.955, 0.024, 228],
    danger: [0.52, 0.19, 24], 'danger-wash': [0.958, 0.024, 24], caution: [0.52, 0.11, 62], 'caution-wash': [0.962, 0.034, 85],
    add: [0.5, 0.13, 150],
    'you-bg': n(0.94, 0.036, 276), 'you-ink': n(0.2, 0.026, 276), 'you-edge': n(0.885, 0.05, 276),
    'code-bg': n(0.968, 0.007), 'code-ink': n(0.24, 0.024, 276),
    'syn-keyword': [0.46, 0.21, 290], 'syn-string': [0.49, 0.12, 152], 'syn-constant': [0.53, 0.13, 50], 'syn-function': [0.48, 0.11, 232],
    'syn-type': [0.49, 0.1, 200], 'syn-punct': n(0.45, 0.02, 276), 'syn-comment': n(0.53, 0.02, 276),
    focus: '#3b2eff',
    field: '#3b2eff', 'on-field': n(0.995, 0.004), 'field-2': [0.88, 0.06, 276],
  },
};

const dark: Appearance = {
  label: 'Dark',
  scheme: 'dark',
  weights: { body: 380, strong: 620, head: 720 },
  stroke: 1.75, bw: '1px', shadow: 'none',
  colors: {
    ground: n(0.17, 0.016, 276), 'ground-2': n(0.148, 0.014, 276), sheet: n(0.208, 0.018, 276), 'sheet-2': n(0.255, 0.02, 276),
    sunken: n(0.135, 0.013, 276), scrim: 'rgba(0, 0, 0, 0.55)',
    ink: n(0.945, 0.008), 'ink-2': n(0.8, 0.014), 'ink-3': n(0.69, 0.016), 'ink-off': n(0.46, 0.014),
    rule: n(0.295, 0.018, 276), 'rule-strong': n(0.53, 0.022, 276),
    indigo: [0.75, 0.135, 280], 'indigo-fill': [0.53, 0.245, 272], 'on-indigo': n(0.995, 0.004), 'indigo-wash': [0.275, 0.062, 276],
    sky: [0.8, 0.09, 222], 'sky-wash': [0.26, 0.036, 228],
    danger: [0.74, 0.14, 22], 'danger-wash': [0.26, 0.05, 22], caution: [0.81, 0.12, 78], 'caution-wash': [0.26, 0.04, 70],
    add: [0.79, 0.13, 152],
    'you-bg': [0.275, 0.062, 276], 'you-ink': n(0.945, 0.008), 'you-edge': [0.36, 0.08, 276],
    'code-bg': n(0.135, 0.013, 276), 'code-ink': n(0.9, 0.01),
    'syn-keyword': [0.77, 0.13, 292], 'syn-string': [0.8, 0.11, 155], 'syn-constant': [0.82, 0.1, 62], 'syn-function': [0.8, 0.085, 222],
    'syn-type': [0.8, 0.08, 195], 'syn-punct': n(0.74, 0.014), 'syn-comment': n(0.66, 0.016),
    focus: [0.75, 0.135, 280],
    field: [0.27, 0.11, 274], 'on-field': n(0.97, 0.006), 'field-2': [0.84, 0.05, 276],
  },
};

const black: Appearance = {
  label: 'Black',
  scheme: 'dark',
  weights: { body: 420, strong: 650, head: 720 },
  stroke: 1.75, bw: '1px', shadow: 'none',
  colors: {
    ground: '#000000', 'ground-2': [0.1, 0.006, 60], sheet: [0.13, 0.007, 60], 'sheet-2': [0.17, 0.009, 60],
    sunken: [0.07, 0.004, 60], scrim: 'rgba(0, 0, 0, 0.7)',
    ink: [0.76, 0.014, 72], 'ink-2': [0.655, 0.014, 72], 'ink-3': [0.59, 0.014, 72], 'ink-off': [0.38, 0.01, 70],
    rule: [0.22, 0.008, 60], 'rule-strong': [0.49, 0.012, 62],
    indigo: [0.66, 0.11, 286], 'indigo-fill': [0.27, 0.085, 282], 'on-indigo': [0.82, 0.055, 286], 'indigo-wash': [0.16, 0.035, 282],
    sky: [0.68, 0.06, 215], 'sky-wash': [0.15, 0.025, 220],
    danger: [0.66, 0.12, 28], 'danger-wash': [0.16, 0.035, 28], caution: [0.72, 0.1, 76], 'caution-wash': [0.16, 0.03, 70],
    add: [0.68, 0.1, 150],
    'you-bg': '#000000', 'you-ink': [0.76, 0.014, 72], 'you-edge': [0.5, 0.09, 286],
    'code-bg': [0.08, 0.004, 60], 'code-ink': [0.74, 0.014, 72],
    'syn-keyword': [0.66, 0.1, 295], 'syn-string': [0.68, 0.09, 150], 'syn-constant': [0.7, 0.09, 62], 'syn-function': [0.68, 0.06, 220],
    'syn-type': [0.68, 0.06, 195], 'syn-punct': [0.62, 0.012, 72], 'syn-comment': [0.58, 0.014, 72],
    focus: [0.66, 0.11, 286],
    field: '#000000', 'on-field': [0.76, 0.014, 72], 'field-2': [0.6, 0.014, 72],
  },
};

const highContrast: Appearance = {
  label: 'High contrast',
  scheme: 'light',
  weights: { body: 480, strong: 720, head: 800 },
  stroke: 2.25, bw: '2px', shadow: 'none',
  colors: {
    ground: '#ffffff', 'ground-2': n(0.962, 0.005), sheet: '#ffffff', 'sheet-2': n(0.93, 0.007),
    sunken: n(0.955, 0.005), scrim: 'rgba(0, 0, 0, 0.5)',
    ink: n(0.13, 0.02, 276), 'ink-2': n(0.28, 0.02, 276), 'ink-3': n(0.36, 0.02, 276), 'ink-off': n(0.6, 0.01),
    rule: n(0.6, 0.012), 'rule-strong': n(0.3, 0.02),
    indigo: [0.385, 0.235, 270], 'indigo-fill': [0.385, 0.235, 270], 'on-indigo': '#ffffff', 'indigo-wash': n(0.925, 0.04, 274),
    sky: [0.37, 0.085, 228], 'sky-wash': [0.93, 0.03, 228],
    danger: [0.42, 0.17, 25], 'danger-wash': [0.93, 0.03, 25], caution: [0.42, 0.095, 60], 'caution-wash': [0.94, 0.045, 85],
    add: [0.38, 0.11, 150],
    'you-bg': n(0.925, 0.04, 274), 'you-ink': n(0.13, 0.02, 276), 'you-edge': n(0.3, 0.02),
    'code-bg': n(0.955, 0.005), 'code-ink': n(0.13, 0.02, 276),
    'syn-keyword': [0.38, 0.2, 290], 'syn-string': [0.38, 0.11, 150], 'syn-constant': [0.42, 0.12, 45], 'syn-function': [0.38, 0.1, 232],
    'syn-type': [0.38, 0.08, 200], 'syn-punct': n(0.32, 0.02, 276), 'syn-comment': n(0.4, 0.02, 276),
    focus: [0.385, 0.235, 270],
    field: [0.385, 0.235, 270], 'on-field': '#ffffff', 'field-2': n(0.93, 0.03, 274),
  },
};

const contrastDark: Appearance = {
  ...dark,
  label: 'High contrast dark',
  weights: { body: 420, strong: 680, head: 780 },
  stroke: 2.25, bw: '2px',
  colors: {
    ...dark.colors,
    ground: n(0.12, 0.012, 276), 'ground-2': n(0.1, 0.01, 276), sheet: n(0.16, 0.014, 276),
    ink: n(0.99, 0.004), 'ink-2': n(0.9, 0.01), 'ink-3': n(0.84, 0.012),
    rule: n(0.5, 0.02, 276), 'rule-strong': n(0.78, 0.02, 276),
    indigo: [0.84, 0.1, 280], 'indigo-fill': [0.45, 0.24, 272], sky: [0.88, 0.07, 222], focus: [0.88, 0.09, 280],
    danger: [0.82, 0.12, 22], 'danger-wash': [0.22, 0.05, 22],
  },
};

const eink: Appearance = {
  label: 'E-ink',
  scheme: 'light',
  weights: { body: 460, strong: 720, head: 800 },
  stroke: 2, bw: '1.5px', shadow: 'none',
  colors: {
    ground: '#ffffff', 'ground-2': '#ffffff', sheet: '#ffffff', 'sheet-2': '#e8e8e8', sunken: '#f2f2f2',
    scrim: 'rgba(255, 255, 255, 0.85)',
    ink: '#000000', 'ink-2': '#1f1f1f', 'ink-3': '#333333', 'ink-off': '#8a8a8a',
    rule: '#000000', 'rule-strong': '#000000',
    indigo: '#000000', 'indigo-fill': '#000000', 'on-indigo': '#ffffff', 'indigo-wash': '#e8e8e8',
    sky: '#000000', 'sky-wash': '#e8e8e8',
    danger: '#000000', 'danger-wash': '#e8e8e8', caution: '#000000', 'caution-wash': '#e8e8e8', add: '#000000',
    'you-bg': '#ffffff', 'you-ink': '#000000', 'you-edge': '#000000',
    'code-bg': '#f2f2f2', 'code-ink': '#000000',
    'syn-keyword': '#000000', 'syn-string': '#333333', 'syn-constant': '#000000', 'syn-function': '#000000',
    'syn-type': '#000000', 'syn-punct': '#333333', 'syn-comment': '#333333',
    focus: '#000000',
    field: '#000000', 'on-field': '#ffffff', 'field-2': '#e8e8e8',
  },
};

export const APPEARANCES: Record<AppearanceName, Appearance> = { light, dark, black, contrast: highContrast, 'contrast-dark': contrastDark, eink };
export const APPEARANCE_NAMES = Object.keys(APPEARANCES) as AppearanceName[];

/** The pairs that must pass, and how well: AA (4.5:1) for text, 3:1 for edges and focus; AAA (7:1) for text in High contrast and E-ink. */
const TEXT: [string, string][] = [
  ['ink', 'ground'], ['ink', 'sheet'], ['ink', 'ground-2'], ['ink', 'sheet-2'], ['ink-2', 'ground'], ['ink-2', 'sheet'], ['ink-2', 'ground-2'],
  ['ink-3', 'ground'], ['ink-3', 'sheet'], ['ink-3', 'ground-2'], ['ink-3', 'sheet-2'], ['ink-3', 'sunken'],
  ['indigo', 'ground'], ['indigo', 'sheet'], ['indigo', 'indigo-wash'], ['ink', 'indigo-wash'], ['on-indigo', 'indigo-fill'],
  ['sky', 'ground'], ['sky', 'sheet'], ['sky', 'sky-wash'], ['danger', 'ground'], ['danger', 'sheet'], ['danger', 'danger-wash'],
  ['caution', 'ground'], ['caution', 'sheet'], ['caution', 'caution-wash'], ['add', 'ground'], ['add', 'sheet'], ['you-ink', 'you-bg'],
  ['code-ink', 'code-bg'], ['syn-keyword', 'code-bg'], ['syn-string', 'code-bg'], ['syn-constant', 'code-bg'], ['syn-function', 'code-bg'],
  ['syn-type', 'code-bg'], ['syn-punct', 'code-bg'], ['syn-comment', 'code-bg'], ['add', 'code-bg'], ['danger', 'code-bg'], ['caution', 'code-bg'],
  ['on-field', 'field'], ['field-2', 'field'],
];
const EDGES: [string, string][] = [['rule-strong', 'sheet'], ['rule-strong', 'ground'], ['focus', 'ground'], ['focus', 'sheet']];

export function pairs(name: AppearanceName): { fg: string; bg: string; min: number }[] {
  const strict = name === 'contrast' || name === 'contrast-dark' || name === 'eink';
  return [
    ...TEXT.map(([fg, bg]) => ({ fg, bg, min: strict && !fg.startsWith('syn-') ? 7 : 4.5 })),
    ...EDGES.map(([fg, bg]) => ({ fg, bg, min: 3 })),
    // Where the person's message has no fill (Black, E-ink), its edge is what shows it.
    ...(name === 'black' || name === 'eink' ? [{ fg: 'you-edge', bg: 'ground', min: 3 }] : []),
  ];
}

// ---------- Colour maths: OKLCH to sRGB (chroma pulled in until it fits), WCAG contrast ----------

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function oklchToLinear([L, C, h]: [number, number, number]): number[] {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}
const inGamut = (rgb: number[]) => rgb.every(c => c >= -1e-6 && c <= 1 + 1e-6);

function oklchToRgb([L, C, h]: [number, number, number]): number[] {
  let rgb = oklchToLinear([L, C, h]);
  if (!inGamut(rgb)) {
    let lo = 0;
    let hi = C;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear([L, mid, h]))) lo = mid;
      else hi = mid;
    }
    rgb = oklchToLinear([L, lo, h]);
  }
  return rgb.map(c => Math.min(1, Math.max(0, toGamma(Math.min(1, Math.max(0, c))))));
}

const hexToRgb = (hex: string) => [0, 2, 4].map(i => parseInt(hex.slice(1 + i, 3 + i), 16) / 255);
const rgbToHex = (rgb: number[]) => '#' + rgb.map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('');

/** A role's value as CSS: hex, or the rgba() it was written as. */
export function cssColor(value: Color): string {
  if (Array.isArray(value)) return rgbToHex(oklchToRgb(value));
  return value;
}

export function contrast(a: Color, b: Color): number {
  const lum = (value: Color) => {
    const rgb = Array.isArray(value) ? oklchToRgb(value) : hexToRgb(value);
    const [r, g, bl] = rgb.map(toLinear);
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// ---------- styles/tokens.css ----------

function block(look: Appearance, indent = '  '): string {
  const lines = [
    `color-scheme: ${look.scheme};`,
    `--w-body: ${look.weights.body}; --w-strong: ${look.weights.strong}; --w-head: ${look.weights.head};`,
    `--stroke: ${look.stroke}; --bw: ${look.bw};`,
    `--shadow: ${look.shadow};`,
    ...Object.entries(look.colors).map(([role, value]) => `--${role}: ${cssColor(value)};`),
  ];
  return lines.map(line => indent + line).join('\n');
}
const oneLine = (look: Appearance) => block(look, '').split('\n').join(' ');

/** The whole of styles/tokens.css. theme.ts sets data-env on <html>; the media rules cover the first paint before it runs. */
export function tokensCss(): string {
  const auto = (query: string, name: AppearanceName) => `@media ${query} {\n  :root:not([data-env]) { ${oneLine(APPEARANCES[name])} }\n}`;
  return [
    '/* GENERATED from styles/appearances.ts by `node scripts/tokens.ts`. Edit that file, not this one. */',
    `:root, :root[data-env="light"] {\n${block(light)}\n}`,
    ...APPEARANCE_NAMES.filter(name => name !== 'light').map(name => `:root[data-env="${name}"] {\n${block(APPEARANCES[name])}\n}`),
    '/* Before theme.ts runs: follow the device. Phones (touch, no hover) get Black in dark mode, as theme.ts decides. */',
    auto('(prefers-color-scheme: dark)', 'dark'),
    auto('(prefers-color-scheme: dark) and (pointer: coarse) and (hover: none)', 'black'),
    auto('(prefers-color-scheme: light) and (prefers-contrast: more)', 'contrast'),
    auto('(prefers-color-scheme: dark) and (prefers-contrast: more)', 'contrast-dark'),
    auto('(update: slow), (monochrome)', 'eink'),
    '',
  ].join('\n\n');
}

/** The page's background in each appearance: the desktop window paints it behind the page while it loads. */
export const groundOf = (name: AppearanceName) => cssColor(APPEARANCES[name].colors.ground);
