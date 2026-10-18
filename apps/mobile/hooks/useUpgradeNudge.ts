import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { usePremium } from '@/contexts/PremiumContext';
import { analyticsService } from '@/services/analyticsService';
import {
  hasShownUpgradeNudge,
  isEngaged,
  loadNudgeStats,
  markUpgradeNudgeShown,
  recordAnswer,
  saveNudgeStats,
} from '@/utils/upgradeNudge';
import { canShowSessionPrompt, markSessionPromptShown } from '@/utils/promptSession';

const SHOW_DELAY_MS = 2500;

/**
 * One-time upgrade nudge: after an answer finishes, once a free user has
 * shown real habit (utils/upgradeNudge). Shown at most once ever and never in
 * the same session as another prompt; re-checks the moment before showing.
 */
export function useUpgradeNudge(isGenerating: boolean) {
  const { isPremium, handleUpgrade } = usePremium();
  const [visible, setVisible] = useState(false);
  const [answers, setAnswers] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isGeneratingRef = useRef(isGenerating);
  const isPremiumRef = useRef(isPremium);

  useEffect(() => {
    isGeneratingRef.current = isGenerating;
    isPremiumRef.current = isPremium;
  }, [isGenerating, isPremium]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  /** Records the answer; resolves true if the nudge was scheduled. */
  const onAnswerCompleted = useCallback(async (): Promise<boolean> => {
    const stats = recordAnswer(await loadNudgeStats(), new Date());
    await saveNudgeStats(stats);
    if (isPremiumRef.current || timerRef.current || !canShowSessionPrompt()) return false;
    if (!isEngaged(stats) || (await hasShownUpgradeNudge())) return false;

    markSessionPromptShown();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (isGeneratingRef.current || isPremiumRef.current || AppState.currentState !== 'active') return;
      setAnswers(stats.answers);
      setVisible(true);
      void markUpgradeNudgeShown();
      void analyticsService.track('upgrade_nudge_shown', { answers: stats.answers, active_days: stats.activeDays.length });
    }, SHOW_DELAY_MS);
    return true;
  }, []);

  const onUnlock = useCallback(() => {
    void analyticsService.track('upgrade_nudge_unlock_tapped', { answers });
    setVisible(false);
    // Straight to the store purchase sheet: one tap fewer than the paywall.
    void handleUpgrade();
  }, [answers, handleUpgrade]);

  const onDismiss = useCallback(() => {
    void analyticsService.track('upgrade_nudge_dismissed', { answers });
    setVisible(false);
  }, [answers]);

  return { visible, answers, onAnswerCompleted, onUnlock, onDismiss };
}
