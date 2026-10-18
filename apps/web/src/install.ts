/**
 * "Install Quo" for the web app. Chromium fires `beforeinstallprompt` once,
 * early in page load, so the listener is attached when this module is first
 * imported (from main.tsx) and the event is kept for when the user asks.
 * Safari has no prompt but supports File → Add to Dock; Firefox can't install
 * web apps, so it gets the desktop app instead.
 */

import { isDesktopApp, isInstalledWebApp } from './platform';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type InstallMethod = 'prompt' | 'safari-dock' | 'safari-ios' | 'none';

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    deferred = null;
    notify();
  });
}

export function subscribeInstall(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isAppInstalled(): boolean {
  return installed || isInstalledWebApp() || isDesktopApp();
}

/** How this browser can install Quo right now. */
export function installMethod(userAgent = navigator.userAgent): InstallMethod {
  if (isAppInstalled()) return 'none';
  if (deferred) return 'prompt';
  const safari = /Safari\//.test(userAgent) && !/Chrome\/|Chromium\/|CriOS|FxiOS|Edg\//.test(userAgent);
  if (safari && /iPhone|iPad|iPod/.test(userAgent)) return 'safari-ios';
  // Add to Dock arrived in Safari 17 (macOS Sonoma).
  const version = Number(/Version\/(\d+)/.exec(userAgent)?.[1] ?? 0);
  if (safari && /Macintosh/.test(userAgent) && version >= 17) return 'safari-dock';
  return 'none';
}

/** Shows the browser's install dialog. Resolves true if the user installed. */
export async function promptInstall(): Promise<boolean> {
  const event = deferred;
  if (!event) return false;
  deferred = null;
  await event.prompt();
  const { outcome } = await event.userChoice;
  notify();
  return outcome === 'accepted';
}
