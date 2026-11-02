import { useSyncExternalStore } from 'react';
import { groundOf, type AppearanceName } from './styles/appearances';

/**
 * Settings → Appearance: a mode (the system's, light or dark) and three switches, each automatic until the person changes
 * it. Black background is on automatically for phones (most have OLED screens, where black pixels are off) and off for
 * computers; High contrast follows the system's "more contrast" setting; E-ink is on for e-ink and monochrome screens.
 * E-ink wins over High contrast, which wins over Black. The result is one appearance from styles/tokens.css, set as
 * data-env on <html> (public/appearance.js does the same before the first paint, so a choice never flashes the device's
 * look). In the desktop app the mode also goes to Electron (its own windows follow) with the appearance (the window
 * colour behind the page), and the browser's theme colour follows the page.
 */

export type ThemeMode = 'system' | 'light' | 'dark';
export type Switch = 'auto' | 'on' | 'off';
export type SwitchName = 'black' | 'contrast' | 'eink';
export interface Appearance { mode: ThemeMode; black: Switch; contrast: Switch; eink: Switch }
/** What the device says, and so what each switch is when left automatic. */
export interface Automatic { dark: boolean; black: boolean; contrast: boolean; eink: boolean; phone: boolean }

export const THEME_MODES: { id: ThemeMode; label: string }[] = [
  { id: 'system', label: 'Auto' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];
export const SWITCH_NAMES: SwitchName[] = ['black', 'contrast', 'eink'];

const DEFAULTS: Appearance = { mode: 'system', black: 'auto', contrast: 'auto', eink: 'auto' };
const KEYS: Record<keyof Appearance, string> = { mode: 'quo.theme', black: 'quo.theme.black', contrast: 'quo.theme.contrast', eink: 'quo.theme.eink' };
const MODES = THEME_MODES.map(choice => choice.id);
const SWITCHES: Switch[] = ['auto', 'on', 'off'];
const valid = <K extends keyof Appearance>(key: K, value: unknown): value is Appearance[K] =>
  key === 'mode' ? (MODES as unknown[]).includes(value) : (SWITCHES as unknown[]).includes(value);

function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function readChoice(): Appearance {
  const choice = { ...DEFAULTS };
  for (const key of Object.keys(KEYS) as (keyof Appearance)[]) {
    const saved = load(KEYS[key]);
    if (valid(key, saved)) (choice as Record<keyof Appearance, string>)[key] = saved;
  }
  // From the earlier setting: a dark style chosen by hand. Black stays black; Midnight was the deep blue, now Dark.
  if (load(KEYS.black) === null) {
    const style = load('quo.theme.dark');
    if (style === 'black') choice.black = 'on';
    if (style === 'midnight') choice.black = 'off';
  }
  return choice;
}

const query = (q: string) => typeof matchMedia === 'function' && matchMedia(q).matches;
const isDesktopApp = () => typeof window !== 'undefined' && Boolean((window as { quoDesktop?: unknown }).quoDesktop);

export function automatic(): Automatic {
  // A touch screen with no hover is a phone or tablet; the desktop app is always a computer.
  const phone = !isDesktopApp() && query('(pointer: coarse) and (hover: none)');
  return { dark: query('(prefers-color-scheme: dark)'), black: phone, contrast: query('(prefers-contrast: more)'), eink: query('(update: slow), (monochrome)'), phone };
}

/** Each switch as it is now: the person's choice, or what the device says. */
export function effective(choice: Appearance, auto: Automatic = automatic()) {
  const pick = (name: SwitchName) => (choice[name] === 'on' ? true : choice[name] === 'off' ? false : auto[name]);
  return { dark: choice.mode === 'system' ? auto.dark : choice.mode === 'dark', black: pick('black'), contrast: pick('contrast'), eink: pick('eink') };
}

export function resolve(choice: Appearance, auto: Automatic = automatic()): AppearanceName {
  const on = effective(choice, auto);
  if (on.eink) return 'eink';
  if (on.contrast) return on.dark ? 'contrast-dark' : 'contrast';
  if (on.dark) return on.black ? 'black' : 'dark';
  return 'light';
}

interface State { choice: Appearance; auto: Automatic; look: AppearanceName }
let state: State | null = null;
const listeners = new Set<() => void>();

function compute(choice: Appearance): State {
  const auto = automatic();
  return { choice, auto, look: resolve(choice, auto) };
}
const current = (): State => (state ??= compute(readChoice()));

export const appearance = (): Appearance => current().choice;

/** Puts the appearance on the page (and the mode and appearance on the desktop app's windows). */
export function applyAppearance(): void {
  if (typeof document === 'undefined') return;
  const { choice, look } = current();
  document.documentElement.dataset.env = look;
  document.querySelector?.('meta[name="theme-color"]')?.setAttribute('content', groundOf(look));
  void window.quoDesktop?.appearance?.set(choice.mode, look).catch(() => {});
}

function update(next: Appearance): void {
  const before = state?.look;
  state = compute(next);
  const change = () => {
    applyAppearance();
    listeners.forEach(listener => listener());
  };
  // A new look cross-fades in where the browser can; at once where it can't, when motion is reduced, or when the look
  // stays the same (a setting that changes nothing on screen, or the device repeating itself).
  const calm = query('(prefers-reduced-motion: reduce)') || before === state.look;
  if (typeof document !== 'undefined' && document.startViewTransition && !calm) document.startViewTransition(change);
  else change();
}

export function setAppearance(patch: Partial<Appearance>): void {
  const next = { ...appearance() };
  for (const key of Object.keys(KEYS) as (keyof Appearance)[]) {
    const value = patch[key];
    if (value === undefined || !valid(key, value)) continue;
    (next as Record<keyof Appearance, string>)[key] = value;
    try {
      // Automatic is the absence of a choice, so the device decides again.
      if (key !== 'mode' && value === 'auto') localStorage.removeItem(KEYS[key]);
      else localStorage.setItem(KEYS[key], value);
    } catch {
      // Private mode: it applies now and won't survive a reload.
    }
  }
  update(next);
}

// The device changing its mind (dark at sunset, more contrast turned on) changes what automatic means.
if (typeof matchMedia === 'function') {
  for (const q of ['(prefers-color-scheme: dark)', '(prefers-contrast: more)', '(update: slow)', '(monochrome)', '(pointer: coarse)']) {
    matchMedia(q).addEventListener?.('change', () => update(appearance()));
  }
}

/** The choice, what the device says, and the appearance in use; re-renders when any of them changes. */
export function useAppearance(): State {
  return useSyncExternalStore(listener => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, current, current); // the app renders only in the browser; tests render on the server and read the same state
}
