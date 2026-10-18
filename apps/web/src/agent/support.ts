import { hasNativeEngine, agentBridge } from '../native';
import type { ModelChoice } from '../models';
import { agentRating, isLocalCodeAllowed, ratingNote, setLocalCodeAllowed } from './capability';

/** Asking before Code mode is used with an offline model that isn't expected to do it well. */
export interface CodeGate {
  name: string;
  /** Why this model is a risky choice, in words. */
  note: string;
  allowed: boolean;
  allow: () => void;
}

export interface CodeSupport {
  /** Code mode can be offered with this model. */
  available: boolean;
  /** The model has a small context window: tool results are kept short. */
  compact: boolean;
  gate: CodeGate | null;
}

const NONE: CodeSupport = { available: false, compact: false, gate: null };

/** Whether, and how, Code mode works with the model a chat is using. */
export function codeSupport(choice: ModelChoice | null): CodeSupport {
  if (!choice || !agentBridge()) return NONE;
  if (choice.kind === 'cloud' || choice.kind === 'own') return { available: choice.model.agent, compact: false, gate: null };
  if (!hasNativeEngine()) return NONE;
  const model = choice.model;
  return {
    available: true,
    compact: true,
    gate: agentRating(model) === 'good' && isLocalCodeAllowed(model) ? null : { name: model.name, note: ratingNote(model), allowed: isLocalCodeAllowed(model), allow: () => setLocalCodeAllowed(model, true) },
  };
}
