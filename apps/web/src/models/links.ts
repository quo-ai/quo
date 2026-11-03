import { useSyncExternalStore } from 'react';
import { isRepoId } from './huggingface';

/**
 * A model someone opened Quo for from outside the app: Hugging Face's "Use this model → Quo" makes a quo:// link, and the
 * desktop app's main process checks it (apps/desktop/src/links.js) before the page takes it. Opening one only shows the
 * model in Models & storage (HuggingFaceModels); the person still chooses a size and presses Add and download.
 */
export interface ModelLink {
  repo: string;
  /** A .gguf in that repository to choose, if the link named one. */
  file?: string;
}

const FILE = /^(?!.*\.\.)(?![/.])[\w.\-/]{1,250}\.gguf$/i;

/** Checked again here: the page trusts no shape it didn't check itself. */
export function toModelLink(value: unknown): ModelLink | null {
  if (!value || typeof value !== 'object') return null;
  const { repo, file } = value as { repo?: unknown; file?: unknown };
  if (!isRepoId(repo)) return null;
  if (file === undefined) return { repo };
  return typeof file === 'string' && FILE.test(file) ? { repo, file } : null;
}

let pending: ModelLink | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** The link waiting to be shown, if any. */
export const useModelLink = (): ModelLink | null => useSyncExternalStore(subscribe, () => pending);

/** Called by whoever shows it, so it's shown once. */
export function clearModelLink(): void {
  pending = null;
  notify();
}

/** Desktop app: takes links that come (and the one that opened the app), calling onOpen so the Models sheet opens. */
export function listenForModelLinks(onOpen: () => void): () => void {
  const links = typeof window === 'undefined' ? undefined : window.quoDesktop?.links;
  if (!links) return () => {};
  const take = async () => {
    try {
      const link = toModelLink((await links.take()).ok);
      if (!link) return;
      pending = link;
      notify();
      onOpen();
    } catch {
      // Builds without the engine have no handler: nothing to show.
    }
  };
  void take();
  return links.onOpen(() => void take());
}
