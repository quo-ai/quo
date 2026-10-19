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
  /** The free model's small Code mode: a few steps a reply, no helpers or summaries. */
  light?: boolean;
  /** Why Code mode can't be used with this model, in words, when the desktop app could otherwise do it. */
  reason?: string;
  gate: CodeGate | null;
}

const NONE: CodeSupport = { available: false, compact: false, gate: null };

/** Whether, and how, Code mode works with the model a chat is using. */
export function codeSupport(choice: ModelChoice | null): CodeSupport {
  if (!choice || !agentBridge()) return NONE;
  if (choice.kind === 'cloud' || choice.kind === 'own') {
    if (choice.model.agent) return { available: true, compact: false, gate: null };
    if (choice.kind === 'cloud' && choice.model.free && choice.model.agentLight) return { available: true, compact: false, gate: null, light: true };
    const name = choice.model.name;
    return {
      available: false,
      compact: false,
      gate: null,
      reason: choice.kind === 'cloud'
        ? `${name} can’t work in a project folder. Code mode needs one of the stronger models (Claude, GPT-6 Astra and others), or an offline model. Choose one from the model menu.`
        : `${name} isn’t marked as able to use tools, so Code mode is off for it. Choose another model from the model menu.`,
    };
  }
  if (!hasNativeEngine()) return NONE;
  const model = choice.model;
  return {
    available: true,
    compact: true,
    gate: agentRating(model) === 'good' && isLocalCodeAllowed(model) ? null : { name: model.name, note: ratingNote(model), allowed: isLocalCodeAllowed(model), allow: () => setLocalCodeAllowed(model, true) },
  };
}
