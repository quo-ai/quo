import type { ThinkLevel } from '../../shared/thinking';
import type { ModelChoice } from '../models';

/**
 * What the person can choose for Thinking with this model. Quo's cloud models say which levels they really have (some
 * always think, some can be switched off, the efforts differ: shared/thinking.ts); an offline model only thinks or
 * doesn't; a model reached with the person's own key has no control from here.
 */
export function thinkingLevels(choice: ModelChoice | null): ThinkLevel[] {
  if (!choice || choice.kind === 'own') return [];
  if (choice.kind === 'local') return choice.model.supportsThinking ? ['off', 'deep'] : [];
  // A server from before levels only knew yes and no.
  return choice.model.thinking ?? (choice.model.supportsThinking ? ['off', 'auto'] : []);
}

/** Where a chat starts: Auto where the model thinks for itself, Off where it doesn't or the model is small and on this computer. */
export function defaultThinking(choice: ModelChoice | null): ThinkLevel {
  if (!choice || choice.kind !== 'cloud') return 'off';
  return thinkingLevels(choice).includes('auto') && choice.model.thinking ? 'auto' : 'off';
}

/** What to send the server: the level, or the old yes or no for a server that doesn't know levels (it would read "off" as yes). */
export function wireThinking(choice: ModelChoice, level: ThinkLevel): ThinkLevel | boolean {
  if (choice.kind === 'cloud' && !choice.model.thinking) return level === 'auto' || level === 'deep';
  return level;
}

export const LEVEL_LABEL: Record<ThinkLevel, string> = { off: 'Off', quick: 'Quick', auto: 'Auto', deep: 'Deep' };

export const levelHint = (level: ThinkLevel, local: boolean): string =>
  level === 'off' ? 'No thinking: the fastest replies'
  : level === 'quick' ? 'Think a little: faster and cheaper'
  : level === 'auto' ? 'The model decides how much to think'
  : local ? 'Reason step by step before answering: slower, for harder questions'
  : 'Think hard: slower and dearer, for difficult problems';

/** The next level in the list, for the /think command. */
export const nextLevel = (levels: ThinkLevel[], current: ThinkLevel): ThinkLevel => levels[(levels.indexOf(current) + 1) % levels.length] ?? levels[0] ?? 'off';
