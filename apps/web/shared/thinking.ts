/**
 * Thinking, as each model really offers it. OpenRouter describes every model's reasoning (checked 19 Oct 2026): some models
 * always think and cannot be told not to (`mandatory`), some can be switched off, and the efforts they accept differ
 * (DeepSeek has no "medium", Mistral only "high" or off, Gemma has only on and off). So there is no one Thinking switch:
 * the person is offered only the levels this model has, and the default, Auto, sends nothing, which leaves the model's
 * own default (for most, it decides for itself how much to think about each question).
 *
 *   off    no thinking (only where the model allows it)
 *   quick  the lowest effort: faster and cheaper
 *   auto   the model's own default
 *   deep   a high effort, for hard problems
 */

export type ThinkLevel = 'off' | 'quick' | 'auto' | 'deep';
export type Effort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ThinkingSpec {
  /** Always thinks: there is no off. */
  mandatory: boolean;
  /** The efforts the model accepts (not counting "none"). Empty when it can only be on or off. */
  efforts: Effort[];
  /** How to turn it off: with effort "none", with `enabled: false`, or not at all. */
  off: 'effort' | 'enabled' | false;
  /** Whether it thinks when nothing is asked of it. */
  defaultOn: boolean;
  /** The effort it uses when nothing is asked of it. */
  default?: Effort;
}

const RANK: Record<Effort, number> = { minimal: 0, low: 1, medium: 2, high: 3, xhigh: 4, max: 5 };
const byRank = (efforts: Effort[]) => [...efforts].sort((a, b) => RANK[a] - RANK[b]);

/** Efforts at or below `cap` (the free model is held to "low"). */
const capped = (spec: ThinkingSpec, cap?: Effort): Effort[] => byRank(spec.efforts.filter(effort => !cap || RANK[effort] <= RANK[cap]));

/** The effort Auto lands on: the model's default, or the highest the cap allows. */
function autoEffort(spec: ThinkingSpec, cap?: Effort): Effort | undefined {
  const allowed = capped(spec, cap);
  if (!allowed.length) return undefined;
  if (spec.default && allowed.includes(spec.default)) return spec.default;
  return cap ? allowed[allowed.length - 1] : spec.default;
}

/** The effort "deep" asks for: the lowest one that is "high" or above, else the highest there is. */
function deepEffort(spec: ThinkingSpec, cap?: Effort): Effort | undefined {
  const allowed = capped(spec, cap);
  return allowed.find(effort => RANK[effort] >= RANK.high) ?? allowed[allowed.length - 1];
}

const quickEffort = (spec: ThinkingSpec, cap?: Effort): Effort | undefined => capped(spec, cap).find(effort => RANK[effort] <= RANK.low);

/** What the person can choose, in order, or nothing when there is no real choice. */
export function levelsFor(spec: ThinkingSpec | null | undefined, cap?: Effort): ThinkLevel[] {
  if (!spec) return [];
  const levels: ThinkLevel[] = [];
  const auto = autoEffort(spec, cap);
  if (spec.off && !spec.mandatory) levels.push('off');
  const quick = quickEffort(spec, cap);
  if (quick && quick !== (auto ?? spec.default)) levels.push('quick');
  if (spec.defaultOn || spec.efforts.length) levels.push('auto');
  const deep = deepEffort(spec, cap);
  if (spec.efforts.length ? deep && deep !== (auto ?? spec.default) : !spec.defaultOn) levels.push('deep');
  return levels.length > 1 ? levels : [];
}

/** The level a chat starts on: Auto where the model thinks by itself, Off where it doesn't. */
export const defaultLevel = (spec: ThinkingSpec | null | undefined): ThinkLevel => (spec && !spec.defaultOn && !spec.efforts.length ? 'off' : 'auto');

/** What to send OpenRouter for a level, or undefined to leave it to the model. A level the model doesn't have is treated as Auto. */
export function reasoningParam(spec: ThinkingSpec | null | undefined, level: ThinkLevel, cap?: Effort): Record<string, unknown> | undefined {
  if (!spec) return undefined;
  if (level === 'off' && spec.off && !spec.mandatory) return spec.off === 'effort' ? { effort: 'none' } : { enabled: false };
  if (level === 'quick') {
    const effort = quickEffort(spec, cap);
    if (effort) return { effort };
  }
  if (level === 'deep') {
    const effort = deepEffort(spec, cap);
    if (effort) return { effort };
    if (!spec.efforts.length && !spec.defaultOn) return { enabled: true };
  }
  const auto = autoEffort(spec, cap);
  return cap && auto && auto !== spec.default ? { effort: auto } : undefined;
}

/** What an older client's true or false meant: false asked for as little as possible (and hid it), true for a medium effort. */
export const levelFromLegacy = (thinking: boolean): ThinkLevel => (thinking ? 'auto' : 'quick');

export const isLevel = (value: unknown): value is ThinkLevel => value === 'off' || value === 'quick' || value === 'auto' || value === 'deep';
