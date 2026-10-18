/**
 * Where Quo is running (browser, installed web app, desktop app) and where
 * its other versions live. Download links use fixed release asset names
 * (apps/desktop/README.md), so they always point at the newest build.
 */

/** The hosted Quo Web; the desktop app sends checkout and API calls here. */
export const WEB_APP_URL = 'https://quoai-app.vercel.app';
export const GITHUB_URL = 'https://github.com/quo-ai/quo';
const RELEASES = `${GITHUB_URL}/releases/latest/download`;

/** null until the App Store listing is live. */
export const APP_STORE_URL: string | null = null;
export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.quo.app';

export type DesktopOS = 'mac' | 'windows' | 'linux';

export const DESKTOP_DOWNLOADS: Record<DesktopOS, { label: string; detail: string; url: string }> = {
  mac: { label: 'macOS', detail: 'Apple silicon and Intel', url: `${RELEASES}/Quo-mac-universal.dmg` },
  windows: { label: 'Windows', detail: 'Windows 10 and 11', url: `${RELEASES}/Quo-windows-x64-setup.exe` },
  linux: { label: 'Linux', detail: 'AppImage', url: `${RELEASES}/Quo-linux-x86_64.AppImage` },
};

/** Running inside the Quo desktop app (Electron preload sets window.quoDesktop). */
export const isDesktopApp = (): boolean => typeof window !== 'undefined' && Boolean(window.quoDesktop);

/** Opened as an installed web app (own window) rather than a browser tab. */
export function isInstalledWebApp(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: window-controls-overlay)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function desktopOS(userAgent = navigator.userAgent): DesktopOS | null {
  if (/Android|iPhone|iPad|iPod/i.test(userAgent)) return null;
  if (/Windows/.test(userAgent)) return 'windows';
  if (/Mac OS X|Macintosh/.test(userAgent)) return 'mac';
  if (/Linux|X11|CrOS/.test(userAgent)) return 'linux';
  return null;
}

/** The store for this phone, or null on a computer (or before the App Store listing). */
export function mobileStoreUrl(userAgent = navigator.userAgent): string | null {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return APP_STORE_URL;
  if (/Android/i.test(userAgent)) return PLAY_STORE_URL;
  return null;
}

/** Opens an external page: the system browser in the desktop app, a new tab on the web. */
export function openExternal(url: string): void {
  window.open(url, '_blank', 'noopener');
}
