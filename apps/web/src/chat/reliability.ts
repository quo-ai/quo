import { getLocalModel, modelSizeBytes } from '../catalog';
import { agentRating } from '../agent/capability';

const LARGE_BYTES = 10e9;

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
  if (rating === 'weak' || rating === 'limited') return 'small model: check facts';
  // The 9B is rated good at tools and still pairs events with the wrong dates; only the largest are left without the note.
  return modelSizeBytes(model) < LARGE_BYTES ? 'offline model: check facts' : null;
}
