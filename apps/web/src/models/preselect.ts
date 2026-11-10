import type { LocalModel } from '../catalog';

/**
 * A model asked for in the page's address (`?model=gemma4-e2b`), so a link can open Quo on one model: from a model's
 * page on the website, a post, or the Hugging Face Space's description. It only preselects what the first screen offers
 * to download: the link never starts a download, and an id this browser can't load is ignored.
 */
export function preselectedModelId(search: string, models: Pick<LocalModel, 'id'>[]): string | null {
  const asked = new URLSearchParams(search).get('model')?.trim().toLowerCase() ?? '';
  return asked && models.some(model => model.id === asked) ? asked : null;
}
