import { RETIRED_MODELS } from '../catalog';
import type { NativeBridge } from '../native';
import { unwrap } from '../native';

/** A model the app no longer offers that is still on this computer, and how much room it takes. */
export interface LeftoverModel {
  id: string;
  name: string;
  bytes: number;
}

type ModelsBridge = Pick<NativeBridge['models'], 'state' | 'remove'>;

/** Which retired models still have files here (partial downloads count: they take room too). */
export async function findLeftovers(bridge: ModelsBridge): Promise<LeftoverModel[]> {
  const found: LeftoverModel[] = [];
  for (const model of RETIRED_MODELS) {
    try {
      const state = unwrap(await bridge.state(model.id, model.files.map(file => ({ ...file, url: 'https://huggingface.co/' }))));
      if (state.downloadedBytes > 0) found.push({ id: model.id, name: model.name, bytes: state.downloadedBytes });
    } catch {
      // Can't tell: leave it.
    }
  }
  return found;
}

/** Removes the given ones; returns what is left (anything that could not be removed). */
export async function removeLeftovers(bridge: ModelsBridge, models: LeftoverModel[]): Promise<LeftoverModel[]> {
  const left: LeftoverModel[] = [];
  for (const model of models) {
    try {
      unwrap(await bridge.remove(model.id));
    } catch {
      left.push(model);
    }
  }
  return left;
}
