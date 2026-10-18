import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { analyticsService } from '@/services/analyticsService';
import { canShowSessionPrompt, markSessionPromptShown } from '@/utils/promptSession';

const SHOW_DELAY_MS = 1200;

/**
 * One-time analytics consent prompt for opt-in regions (EU/EEA; see
 * utils/analyticsConsent). Collection stays off until the user answers, so
 * the prompt never blocks anything: it waits for an idle chat screen, takes
 * the session's single prompt slot, and if that slot is taken it simply
 * tries again next launch.
 */
export function useAnalyticsConsent(isGenerating: boolean) {
  const [needed, setNeeded] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let mounted = true;
    void analyticsService.isConsentPromptNeeded().then(value => {
      if (mounted) setNeeded(value);
    });
    const unsubscribe = analyticsService.subscribeConsentPrompt(setNeeded);
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!needed || visible || isGenerating) return;
    const timer = setTimeout(() => {
      if (AppState.currentState !== 'active' || !canShowSessionPrompt()) return;
      markSessionPromptShown();
      setVisible(true);
    }, SHOW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [needed, visible, isGenerating]);

  const choose = useCallback((allow: boolean) => {
    setVisible(false);
    void analyticsService.setAnalyticsEnabled(allow);
  }, []);

  const onAllow = useCallback(() => choose(true), [choose]);
  const onDecline = useCallback(() => choose(false), [choose]);

  return { visible, onAllow, onDecline };
}
