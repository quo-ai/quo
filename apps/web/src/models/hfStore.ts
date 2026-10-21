import { useSyncExternalStore } from 'react';
import type { LocalModel } from '../catalog';

/**
 * Models the person added from Hugging Face (desktop app), kept on this device like the catalog's: their files live in
 * the models folder under their id, and removing one deletes them. Each entry is checked when read back, so a changed
 * storage value can point a download only at a Hugging Face file with a known name and size.
 */

const KEY = 'quo.hfModels';
const ID = /^hf-[a-z0-9][a-z0-9._-]{0,60}$/;
const FILE_NAMES = new Set(['model.gguf', 'mmproj.gguf']);

const listeners = new Set<() => void>();
let cache: LocalModel[] | null = null;

function valid(model: unknown): model is LocalModel {
  const m = model as LocalModel;
  if (!m || typeof m !== 'object' || typeof m.id !== 'string' || !ID.test(m.id) || typeof m.name !== 'string') return false;
  if (!Array.isArray(m.files) || m.files.length < 1 || m.files.length > 2 || m.files[0].name !== 'model.gguf') return false;
  const files = m.files.every(file => {
    try {
      const url = new URL(file.url);
      return url.protocol === 'https:' && url.hostname === 'huggingface.co' && FILE_NAMES.has(file.name) && Number.isSafeInteger(file.sizeBytes) && file.sizeBytes > 0;
    } catch {
      return false;
    }
  });
  return files && new Set(m.files.map(file => file.name)).size === m.files.length && m.source?.kind === 'huggingface' && m.native === true && !m.custom;
}

function read(): LocalModel[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(list) ? list.filter(valid) : [];
  } catch {
    return [];
  }
}

function write(list: LocalModel[]): void {
  cache = list;
  localStorage.setItem(KEY, JSON.stringify(list));
  listeners.forEach(listener => listener());
}

export const getHfModels = (): LocalModel[] => (cache ??= typeof localStorage === 'undefined' ? [] : read());

export function addHfModel(model: LocalModel): LocalModel {
  if (!valid(model)) throw new Error('That model can’t be added.');
  write([...getHfModels().filter(m => m.id !== model.id), model]);
  return model;
}

export function forgetHfModel(id: string): void {
  write(getHfModels().filter(m => m.id !== id));
}

export function subscribeHfModels(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const useHfModels = (): LocalModel[] => useSyncExternalStore(subscribeHfModels, getHfModels);
