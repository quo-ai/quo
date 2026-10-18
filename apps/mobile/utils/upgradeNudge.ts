import AsyncStorage from '@react-native-async-storage/async-storage';

// One-time upgrade nudge for engaged free users. It targets proven habit
// (many answers across several separate days), which converts far better
// than an early or repeated paywall, and it is shown once, ever.

const SHOWN_KEY = '@upgrade_nudge_shown';
const STATS_KEY = '@upgrade_nudge_stats';

export const NUDGE_MIN_ANSWERS = 12;
export const NUDGE_MIN_ACTIVE_DAYS = 3;

export interface NudgeStats {
  answers: number;
  /** Distinct local days (YYYY-MM-DD) with at least one answer, capped. */
  activeDays: string[];
}

function dayKey(now: Date): string {
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${m}-${d}`;
}

/** Pure: stats after one more completed answer. */
export function recordAnswer(stats: NudgeStats, now: Date): NudgeStats {
  const day = dayKey(now);
  const activeDays = stats.activeDays.includes(day)
    ? stats.activeDays
    : [...stats.activeDays, day].slice(-NUDGE_MIN_ACTIVE_DAYS * 2);
  return { answers: stats.answers + 1, activeDays };
}

/** Pure: whether usage shows enough habit to nudge. */
export function isEngaged(stats: NudgeStats): boolean {
  return stats.answers >= NUDGE_MIN_ANSWERS && stats.activeDays.length >= NUDGE_MIN_ACTIVE_DAYS;
}

export async function loadNudgeStats(): Promise<NudgeStats> {
  try {
    const raw = await AsyncStorage.getItem(STATS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<NudgeStats>) : {};
    return { answers: parsed.answers ?? 0, activeDays: parsed.activeDays ?? [] };
  } catch {
    return { answers: 0, activeDays: [] };
  }
}

export async function saveNudgeStats(stats: NudgeStats): Promise<void> {
  await AsyncStorage.setItem(STATS_KEY, JSON.stringify(stats)).catch(() => {});
}

export async function hasShownUpgradeNudge(): Promise<boolean> {
  return (await AsyncStorage.getItem(SHOWN_KEY).catch(() => null)) === 'true';
}

export async function markUpgradeNudgeShown(): Promise<void> {
  await AsyncStorage.setItem(SHOWN_KEY, 'true').catch(() => {});
}
