import { useSyncExternalStore } from 'react';

/**
 * Settings → Appearance: light, dark or the system's choice; how dark looks (Black, the default, or Midnight); and the
 * accent (Indigo, the default, or Mono). The colours themselves are tokens in styles/base.css and styles/themes.css;
 * this only puts attributes on <html>, and only for a choice that isn't the default: data-theme overrides the system,
 * data-dark="midnight", data-accent="mono". In the desktop app the scheme and dark style also go to Electron, so its
 * own windows and the window behind the page follow them.
 */

export type ThemeMode = 'system' | 'light' | 'dark';
export type DarkStyle = 'black' | 'midnight';
export type Accent = 'indigo' | 'mono';
export interface Appearance { mode: ThemeMode; dark: DarkStyle; accent: Accent }

export const THEME_MODES: { id: ThemeMode; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];
export const DARK_STYLES: { id: DarkStyle; label: string }[] = [
  { id: 'black', label: 'Black' },
  { id: 'midnight', label: 'Midnight' },
];
export const ACCENTS: { id: Accent; label: string }[] = [
  { id: 'indigo', label: 'Indigo' },
  { id: 'mono', label: 'Mono' },
];

const DEFAULTS: Appearance = { mode: 'system', dark: 'black', accent: 'indigo' };
const KEYS: Record<keyof Appearance, string> = { mode: 'quo.theme', dark: 'quo.theme.dark', accent: 'quo.theme.accent' };
const ALLOWED: { [K in keyof Appearance]: readonly Appearance[K][] } = {
  mode: THEME_MODES.map(choice => choice.id),
  dark: DARK_STYLES.map(choice => choice.id),
  accent: ACCENTS.map(choice => choice.id),
};
const valid = <K extends keyof Appearance>(key: K, value: unknown): value is Appearance[K] => (ALLOWED[key] as readonly unknown[]).includes(value);

function readOne<K extends keyof Appearance>(key: K): Appearance[K] {
  try {
    const saved = localStorage.getItem(KEYS[key]);
    return valid(key, saved) ? saved : DEFAULTS[key];
  } catch {
    return DEFAULTS[key];
  }
}

let current: Appearance | null = null;
const listeners = new Set<() => void>();

export const appearance = (): Appearance => (current ??= { mode: readOne('mode'), dark: readOne('dark'), accent: readOne('accent') });

function mark(name: string, value: string | null): void {
  if (value === null) delete document.documentElement.dataset[name];
  else document.documentElement.dataset[name] = value;
}

/** Puts the choices on the page (and the scheme on the desktop app's windows). */
export function applyAppearance(choice: Appearance = appearance()): void {
  if (typeof document === 'undefined') return;
  mark('theme', choice.mode === 'system' ? null : choice.mode);
  mark('dark', choice.dark === 'black' ? null : choice.dark);
  mark('accent', choice.accent === 'indigo' ? null : choice.accent);
  void window.quoDesktop?.appearance?.set(choice.mode, choice.dark).catch(() => {});
}

export function setAppearance(patch: Partial<Appearance>): void {
  const next = { ...appearance() };
  for (const key of Object.keys(KEYS) as (keyof Appearance)[]) {
    const value = patch[key];
    if (value === undefined || !valid(key, value)) continue;
    (next as Record<keyof Appearance, string>)[key] = value;
    try {
      localStorage.setItem(KEYS[key], value);
    } catch {
      // Private mode: it applies now and won't survive a reload.
    }
  }
  current = next;
  applyAppearance(next);
  listeners.forEach(listener => listener());
}

export function useAppearance(): Appearance {
  return useSyncExternalStore(listener => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, appearance, () => DEFAULTS);
}
