import { useSyncExternalStore } from 'react';
import { NativeError, unwrap, type OwnImageModel } from '../native';
import type { ImageModel } from './deviceModels';

/**
 * Image model files the person added in the desktop app (apps/desktop/src/images/custom.js): a checkpoint (SDXL, SD 1.5)
 * or a fine-tune of Z-Image or FLUX.2 klein, recognised by main from inside the file. The page knows their id, name and
 * family only. They are used like Quo's own image models, and are always there (nothing to download).
 */

const bridge = () => (typeof window === 'undefined' ? null : window.quoDesktop?.images?.custom ?? null);
let own: ImageModel[] = [];
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());

const asModel = (entry: OwnImageModel): ImageModel & { own: true; needs?: string } => ({
  id: entry.id, name: entry.name, maker: 'Your file', licence: entry.label, description: `${entry.label} model from your computer.`,
  files: [], steps: entry.steps, cfg: entry.cfg, minMemoryGB: 0, edits: entry.edits, own: true, ...(entry.needs ? { needs: entry.needs } : {}),
});

export const ownImageModels = (): ImageModel[] => own;
export const canAddImageModels = (): boolean => bridge() !== null;

export async function refreshOwnImageModels(): Promise<void> {
  const custom = bridge();
  if (!custom) return;
  own = unwrap(await custom.list()).map(asModel);
  notify();
}

/** The native dialog; null if the person closed it. Throws with main's reason when the file can't be used. */
export async function addOwnImageModel(): Promise<ImageModel | null> {
  const custom = bridge();
  if (!custom) throw new NativeError('unavailable', 'Update the Quo app to add image models.');
  const added = unwrap(await custom.pick());
  await refreshOwnImageModels();
  return added ? asModel(added) : null;
}

export async function removeOwnImageModel(id: string): Promise<void> {
  const custom = bridge();
  if (!custom) return;
  unwrap(await custom.remove(id));
  await refreshOwnImageModels();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
export const useOwnImageModels = (): ImageModel[] => useSyncExternalStore(subscribe, ownImageModels);
