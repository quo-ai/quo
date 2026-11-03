import type { ImagePrefs } from './prefs';

/** Where one image is made: on this computer, in Quo's cloud, or ask the person first. */
export type ImagePlace = 'device' | 'cloud' | 'ask';

/**
 * By default an image is made where its chat runs, as every reply shows. An offline chat never sends a picture's
 * description to the cloud without asking (offline stays offline), unless the person said not to ask. `want` is a
 * choice made on the image itself ("Make it in the cloud", "Make it on this computer").
 */
export function imagePlace(chat: 'local' | 'cloud' | 'own', { deviceReady, prefs, want }: { deviceReady: boolean; prefs: ImagePrefs; want?: 'device' | 'cloud' }): ImagePlace {
  if (want) return want;
  if (deviceReady && (chat === 'local' || prefs.everyOnDevice)) return 'device';
  if (chat === 'local') return prefs.offlineCloud === 'allow' ? 'cloud' : 'ask';
  return 'cloud';
}
