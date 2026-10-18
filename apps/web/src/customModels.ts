import { useSyncExternalStore } from 'react';
import type { LocalModel } from './catalog';
import { nativeBridge, unwrap, type CustomModelEntry } from './native';

/**
 * Models the user already has on this computer (a file they picked, or ones
 * found in LM Studio and Ollama), used in place by the desktop app's native
 * engine. They behave like catalog models: they're always "installed", and
 * removing one only forgets it; the file stays where it is.
 */

let models: LocalModel[] = [];
const listeners = new Set<() => void>();

const GENERIC_SAMPLING = { temperature: 0.7, top_p: 0.9, top_k: 40, min_p: 0.05 };

function toModel(entry: CustomModelEntry): LocalModel {
  return {
    id: entry.id,
    name: entry.name,
    description: entry.source === 'lmstudio' ? 'From LM Studio, used where it is.'
      : entry.source === 'ollama' ? 'From Ollama, used where it is.'
        : 'Added from your computer, used where it is.',
    files: [{ url: '', name: 'model.gguf', sizeBytes: entry.sizeBytes }],
    contextSize: 16384,
    maxTokens: 4096,
    sampling: GENERIC_SAMPLING,
    supportsThinking: false,
    minMemoryGB: Math.ceil((entry.sizeBytes / 1e9) * 1.3),
    vision: Boolean(entry.mmprojPath),
    native: true,
    custom: true,
  };
}

const emit = () => listeners.forEach(listener => listener());

export const getCustomModels = (): LocalModel[] => models;
export const getCustomModel = (id: string): LocalModel | undefined => models.find(model => model.id === id);

export function subscribeCustomModels(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** For components: re-renders when models are added or forgotten. */
export function useCustomModels(): LocalModel[] {
  return useSyncExternalStore(subscribeCustomModels, getCustomModels);
}

export async function refreshCustomModels(): Promise<void> {
  const bridge = nativeBridge();
  if (!bridge) return;
  try {
    models = unwrap(await bridge.models.custom.list()).map(toModel);
  } catch {
    models = [];
  }
  emit();
}

export async function addCustomModelFile(): Promise<LocalModel | null> {
  const bridge = nativeBridge();
  if (!bridge) return null;
  const entry = unwrap(await bridge.models.custom.pick());
  await refreshCustomModels();
  return entry ? toModel(entry) : null;
}

export async function addCustomModel(entry: CustomModelEntry): Promise<LocalModel> {
  const bridge = nativeBridge();
  if (!bridge) throw new Error('not_desktop');
  const added = unwrap(await bridge.models.custom.add(entry.path, { name: entry.name, mmprojPath: entry.mmprojPath }));
  await refreshCustomModels();
  return toModel(added);
}

export async function forgetCustomModel(id: string): Promise<void> {
  const bridge = nativeBridge();
  if (!bridge) return;
  unwrap(await bridge.models.custom.remove(id));
  await refreshCustomModels();
}

/** Models in LM Studio's and Ollama's folders that haven't been added yet. */
export async function findExternalModels(): Promise<CustomModelEntry[]> {
  const bridge = nativeBridge();
  return bridge ? unwrap(await bridge.models.custom.scan()) : [];
}
