import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { incrementMessageCount, shouldShowReviewPrompt, markReviewPromptShown } from '@/utils/reviewPrompt';
import { analyticsService } from '@/services/analyticsService';
import { canShowSessionPrompt, markSessionPromptShown } from '@/utils/promptSession';

const SHOW_DELAY_MS = 2000;
const SOURCE = 'post_successful_answer';

/**
 * In-app review prompt shown a moment after a successful answer, once the
 * answer-count threshold is reached. Shown at most once ever: it is marked
 * (and tracked) when it actually appears, and the delayed show re-checks
 * that nothing is generating and the app is still in the foreground.
 */
export function useReviewPrompt(isGenerating: boolean) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduledRef = useRef(false);
  const isGeneratingRef = useRef(isGenerating);

  useEffect(() => {
    isGeneratingRef.current = isGenerating;
  }, [isGenerating]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const onAnswerCompleted = useCallback(async () => {
    await incrementMessageCount();
    if (scheduledRef.current || !canShowSessionPrompt()) return;
    if (!(await shouldShowReviewPrompt())) return;
    scheduledRef.current = true;
    markSessionPromptShown();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (isGeneratingRef.current || AppState.currentState !== 'active') {
        // Bad moment — try again after the next answer.
        scheduledRef.current = false;
        return;
      }
      setVisible(true);
      void analyticsService.trackReviewPromptShown(SOURCE);
      void markReviewPromptShown();
    }, SHOW_DELAY_MS);
  }, []);

  const onDismiss = useCallback(() => {
    void analyticsService.trackReviewPromptDismissed(SOURCE);
    setVisible(false);
    // ReviewPrompt's "Maybe Later" snooze relies on the caller marking here.
    void markReviewPromptShown();
  }, []);

  const onRate = useCallback(() => {
    void analyticsService.trackReviewPromptRated(SOURCE);
    setVisible(false);
    void markReviewPromptShown();
  }, []);

  return { visible, onAnswerCompleted, onDismiss, onRate };
}
