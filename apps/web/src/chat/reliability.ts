import { getLocalModel } from '../catalog';
import { agentRating } from '../agent/capability';

/**
 * A small offline model is quick and private but remembers little: asked about the past it can state invented
 * "facts" in a confident voice, and no instruction to the model changes what it never learned. So replies from the smaller
 * ones say so, once, under the reply. The rating is the one already used for Code mode: 9 billion parameters and up is "good".
 */
export function reliabilityNote(modelId: string | undefined): string | null {
  if (!modelId) return null;
  const model = getLocalModel(modelId);
  if (!model) return null;
  const rating = agentRating(model);
  return rating === 'weak' || rating === 'limited' ? 'small model: check facts' : null;
}
