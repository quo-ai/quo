import { useSyncExternalStore } from 'react';

/** Where pictures are made, as the person chose (images/place.ts uses them). Kept in this browser or app only. */
export interface ImagePrefs {
  /** Make every chat's images on this computer when an image model is downloaded, cloud chats too. */
  everyOnDevice: boolean;
  /** An offline chat with no image model: ask before sending the picture's description to the cloud, or don't ask. */
  offlineCloud: 'ask' | 'allow';
  /** The image model to use when more than one is downloaded (its id); otherwise the first one downloaded. */
  model: string | null;
  /** Standard (about a megapixel) or quick (about half: roughly a third faster). */
  size: 'standard' | 'quick';
}

const KEY = 'quo:image-prefs';
const DEFAULTS: ImagePrefs = { everyOnDevice: false, offlineCloud: 'ask', model: null, size: 'standard' };
const listeners = new Set<() => void>();
let cached: ImagePrefs | null = null;

function read(): ImagePrefs {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<ImagePrefs>;
    return { everyOnDevice: saved.everyOnDevice === true, offlineCloud: saved.offlineCloud === 'allow' ? 'allow' : 'ask', model: typeof saved.model === 'string' ? saved.model : null, size: saved.size === 'quick' ? 'quick' : 'standard' };
  } catch {
    return DEFAULTS;
  }
}

export const imagePrefs = (): ImagePrefs => (cached ??= typeof localStorage === 'undefined' ? DEFAULTS : read());

export function setImagePrefs(patch: Partial<ImagePrefs>): void {
  cached = { ...imagePrefs(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(cached));
  } catch {
    // Not saved (private mode): it still applies until the page is closed.
  }
  listeners.forEach(listener => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
export const useImagePrefs = (): ImagePrefs => useSyncExternalStore(subscribe, imagePrefs);
