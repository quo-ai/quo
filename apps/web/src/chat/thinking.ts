import type { ThinkChoice, ThinkLevel } from '../../shared/thinking';
import type { ModelChoice } from '../models';

/**
 * What the person can choose for Thinking with this model. Quo's cloud models say which levels they really have (some
 * always think, some can be switched off, the efforts differ: shared/thinking.ts); an offline model only thinks or
 * doesn't; a model reached with the person's own key has what its provider reported (Claude Agent: Claude Code's own
 * efforts for that model), or nothing.
 */
export function thinkingLevels(choice: ModelChoice | null): ThinkChoice[] {
  if (!choice) return [];
  if (choice.kind === 'own') return choice.model.thinking ?? [];
  if (choice.kind === 'local') return choice.model.supportsThinking ? ['off', 'deep'] : [];
  // A server from before levels only knew yes and no.
  return choice.model.thinking ?? (choice.model.supportsThinking ? ['off', 'auto'] : []);
}

/**
 * Where a chat starts: Auto where the model thinks for itself, Off where it doesn't or the model is small and on this
 * computer. A Claude Agent model starts on Claude Code's default effort for it.
 */
export function defaultThinking(choice: ModelChoice | null): ThinkChoice {
  if (choice?.kind === 'own') {
    const levels = thinkingLevels(choice);
    const start = choice.model.thinkingDefault;
    return start && levels.includes(start) ? start : levels.includes('auto') ? 'auto' : 'off';
  }
  if (!choice || choice.kind !== 'cloud') return 'off';
  return thinkingLevels(choice).includes('auto') && choice.model.thinking ? 'auto' : 'off';
}

/** What to send the server: the level, or the old yes or no for a server that doesn't know levels (it would read "off" as yes). */
export function wireThinking(choice: ModelChoice, level: ThinkLevel): ThinkLevel | boolean {
  if (choice.kind === 'cloud' && !choice.model.thinking) return level === 'auto' || level === 'deep';
  return level;
}

export const LEVEL_LABEL: Record<ThinkChoice, string> = { off: 'Off', quick: 'Quick', auto: 'Auto', deep: 'Deep', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' };

export const levelHint = (level: ThinkChoice, local: boolean): string =>
  level === 'off' ? 'No thinking: the fastest replies'
  : level === 'quick' ? 'Think a little: faster and cheaper'
  : level === 'auto' ? 'The model decides how much to think'
  : local ? 'Reason step by step before answering: slower, for harder questions'
  : 'Think hard: slower and dearer, for difficult problems';

/** The next level in the list, for the /think command. */
export const nextLevel = (levels: ThinkChoice[], current: ThinkChoice): ThinkChoice => levels[(levels.indexOf(current) + 1) % levels.length] ?? levels[0] ?? 'off';
