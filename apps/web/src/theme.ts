import { useSyncExternalStore } from 'react';

/**
 * Light, dark, or the system's choice (Settings → Appearance). The colours themselves are light-dark() tokens in
 * styles/base.css; this only picks the scheme: no attribute follows the system, data-theme on <html> overrides it. In
 * the desktop app the choice also goes to Electron, so its own windows (the approval window) follow it.
 */

export type ThemeMode = 'system' | 'light' | 'dark';
export const THEME_MODES: { id: ThemeMode; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

const KEY = 'quo.theme';
const isMode = (value: unknown): value is ThemeMode => value === 'system' || value === 'light' || value === 'dark';

function read(): ThemeMode {
  try {
    const saved = localStorage.getItem(KEY);
    return isMode(saved) ? saved : 'system';
  } catch {
    return 'system';
  }
}

let current: ThemeMode | null = null;
const listeners = new Set<() => void>();

export const themeMode = (): ThemeMode => (current ??= read());

/** Puts the scheme on the page (and on the desktop app's windows). */
export function applyTheme(mode: ThemeMode = themeMode()): void {
  if (typeof document === 'undefined') return;
  if (mode === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = mode;
  void window.quoDesktop?.appearance?.set(mode).catch(() => {});
}

export function setThemeMode(mode: ThemeMode): void {
  if (!isMode(mode)) return;
  current = mode;
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // Private mode: it applies now and won't survive a reload.
  }
  applyTheme(mode);
  listeners.forEach(listener => listener());
}

export function useThemeMode(): ThemeMode {
  return useSyncExternalStore(listener => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, themeMode, () => 'system');
}
