import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState } from 'react-native';
import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from 'expo-audio';
import { whisperService, type RealtimeSession, type RealtimeStopReason } from '@/services/whisperService';
import { consumeTrialUse, hasRemainingTrialUses } from '@/services/trialService';
import { PREMIUM_FEATURES } from '@/constants/premium';
import { analyticsService } from '@/services/analyticsService';

type StopReason = 'user' | 'background' | 'unmount' | RealtimeStopReason;

interface UseVoiceInputOptions {
  /** Current composer text; the transcription is appended to it. */
  message: string;
  setMessage: (text: string) => void;
  isPremium: boolean;
  checkPremiumFeature: (featureName: string) => boolean;
  showToast: (text: string) => void;
}

function voiceAnalyticsBase() {
  const voiceModel = whisperService.getModelInfo();
  return {
    source: 'realtime',
    voice_model_id: voiceModel.id,
    voice_language: whisperService.getTranscriptionLanguage(),
    multilingual: voiceModel.supportsMultilingual,
  };
}

/**
 * Voice input state machine: idle → starting → recording → finalizing → idle.
 *
 * - start is guarded by a ref so double taps can't start two sessions or
 *   consume two trial uses; the trial use is consumed only once the mic is
 *   actually running.
 * - stop awaits the session's final transcription pass, so the last words
 *   spoken are never lost.
 * - a stop requested while starting (app backgrounded, unmount) is applied
 *   as soon as the start resolves; backgrounding stops an active recording.
 */
export function useVoiceInput({
  message,
  setMessage,
  isPremium,
  checkPremiumFeature,
  showToast,
}: UseVoiceInputOptions) {
  const [isStarting, setIsStarting] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [realtimeText, setRealtimeText] = useState('');
  const [showVoiceModelModal, setShowVoiceModelModal] = useState(false);

  const sessionRef = useRef<RealtimeSession | null>(null);
  const startingRef = useRef(false);
  const finalizingRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const mountedRef = useRef(true);
  const voiceStartedAtRef = useRef<number | null>(null);
  // The message text that existed before voice input started
  const baseMessageRef = useRef('');
  const messageRef = useRef(message);

  useEffect(() => {
    messageRef.current = message;
  }, [message]);

  const finalizeSession = useCallback(async (reason: StopReason) => {
    const session = sessionRef.current;
    if (!session || finalizingRef.current) return;
    finalizingRef.current = true;
    if (mountedRef.current) setIsFinalizing(true);

    const startedAt = voiceStartedAtRef.current;
    const durationMs = startedAt ? Date.now() - startedAt : undefined;
    // Alerts only make sense if the user is looking at the screen.
    const canAlert = () => mountedRef.current && reason !== 'background' && reason !== 'unmount';

    try {
      const transcription = (await session.stop()).trim();

      if (transcription) {
        const base = baseMessageRef.current;
        const separator = base ? ' ' : '';
        if (mountedRef.current) setMessage(base + separator + transcription);
        void analyticsService.trackVoiceInputCompleted({
          ...voiceAnalyticsBase(),
          char_count: transcription.length,
          duration_ms: durationMs,
        });
      } else {
        void analyticsService.trackVoiceInputFailed({
          ...voiceAnalyticsBase(),
          error: reason === 'mic_error' ? 'mic_error' : 'no_speech_detected',
          duration_ms: durationMs,
        });
        if (canAlert()) {
          if (reason === 'mic_error') {
            Alert.alert(
              'Microphone Unavailable',
              'Could not capture audio from the microphone. Make sure no other app is using it and try again.',
            );
          } else {
            Alert.alert('No Speech Detected', 'Please speak clearly and try again.');
          }
        }
      }

      if (reason === 'max_duration' && mountedRef.current) {
        showToast('Voice input stops after 60 seconds');
      }
    } catch (error) {
      console.error('[useVoiceInput] Error stopping transcription:', error);
      void analyticsService.trackVoiceInputFailed({
        ...voiceAnalyticsBase(),
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      sessionRef.current = null;
      finalizingRef.current = false;
      voiceStartedAtRef.current = null;
      baseMessageRef.current = '';
      if (mountedRef.current) {
        setIsRecording(false);
        setIsFinalizing(false);
        setRealtimeText('');
      }
    }
  }, [setMessage, showToast]);

  const startRecording = useCallback(async () => {
    if (startingRef.current || sessionRef.current || finalizingRef.current) return;
    startingRef.current = true;
    stopRequestedRef.current = false;
    setIsStarting(true);

    try {
      // Check existing permission status first — avoids triggering the Samsung
      // "Voice Input permissions" overlay on devices where it's already granted.
      const existing = await getRecordingPermissionsAsync();
      let granted = existing.status === 'granted';
      if (!granted) {
        const { status } = await requestRecordingPermissionsAsync();
        granted = status === 'granted';
      }
      if (!granted) {
        Alert.alert('Microphone Access', 'Please enable microphone access in your device settings.');
        return;
      }

      const modelDownloaded = await whisperService.isModelDownloaded();
      if (!modelDownloaded) {
        setShowVoiceModelModal(true);
        return;
      }

      // Premium users pass straight through; free users need a remaining
      // trial use (consumed below once recording has actually started), and
      // hit the paywall once the trial is exhausted.
      if (!isPremium && !(await hasRemainingTrialUses(PREMIUM_FEATURES.VOICE_INPUT))) {
        checkPremiumFeature(PREMIUM_FEATURES.VOICE_INPUT);
        return;
      }

      if (!whisperService.isReady()) {
        let initialized = await whisperService.initialize();
        // A shared in-flight init may have been for a previously selected model.
        if (initialized && !whisperService.isReady()) {
          initialized = await whisperService.initialize();
        }
        if (!initialized) {
          if (!stopRequestedRef.current) {
            Alert.alert('Voice Error', 'Could not initialize voice recognition.');
          }
          return;
        }
      }

      if (stopRequestedRef.current || !mountedRef.current) return;

      // Save current message as base to append to
      baseMessageRef.current = messageRef.current;
      setRealtimeText('');

      const session = await whisperService.startRealtimeTranscription();
      sessionRef.current = session;
      voiceStartedAtRef.current = Date.now();
      session.subscribe((result: string) => {
        if (sessionRef.current === session && mountedRef.current) {
          setRealtimeText(result.trim());
        }
      });
      // 60s cap / mic failure: finalize exactly like a user stop.
      session.onAutoStop((reason) => {
        if (sessionRef.current === session) void finalizeSession(reason);
      });
      if (mountedRef.current) setIsRecording(true);

      if (!isPremium) {
        const remaining = await consumeTrialUse(PREMIUM_FEATURES.VOICE_INPUT);
        if (remaining < 0) {
          // Exhausted by a concurrent use between the check and now.
          if (sessionRef.current === session) {
            sessionRef.current = null;
            void session.stop().catch(() => '');
            if (mountedRef.current) setIsRecording(false);
          }
          checkPremiumFeature(PREMIUM_FEATURES.VOICE_INPUT);
          return;
        }
        showToast(
          remaining === 0
            ? 'Last free voice input — Premium unlocks unlimited'
            : `${remaining} free voice input${remaining === 1 ? '' : 's'} left`,
        );
      }
    } catch (error) {
      console.error('[useVoiceInput] Error starting recording:', error);
      if (mountedRef.current) {
        Alert.alert('Voice Error', 'Could not start voice recognition. Please try again.');
      }
    } finally {
      startingRef.current = false;
      if (mountedRef.current) setIsStarting(false);
      // A stop requested while starting (backgrounded / unmounted) applies now.
      if (
        sessionRef.current &&
        (stopRequestedRef.current || !mountedRef.current || AppState.currentState === 'background')
      ) {
        void finalizeSession(mountedRef.current ? 'background' : 'unmount');
      }
    }
  }, [isPremium, checkPremiumFeature, showToast, finalizeSession]);

  const stopRecording = useCallback(() => {
    if (startingRef.current) {
      stopRequestedRef.current = true;
      return;
    }
    void finalizeSession('user');
  }, [finalizeSession]);

  const toggleVoice = useCallback(() => {
    if (startingRef.current || sessionRef.current) {
      stopRecording();
    } else {
      void startRecording();
    }
  }, [startRecording, stopRecording]);

  // Stop recording when the app is backgrounded. Only 'background' counts:
  // iOS reports 'inactive' while the mic permission prompt is showing.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState !== 'background') return;
      if (startingRef.current) {
        stopRequestedRef.current = true;
      } else if (sessionRef.current) {
        void finalizeSession('background');
      }
    });
    return () => subscription.remove();
  }, [finalizeSession]);

  // Cleanup on unmount: never leave the mic running.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopRequestedRef.current = true;
      void sessionRef.current?.stop().catch(() => '');
    };
  }, []);

  const closeVoiceModelModal = useCallback(() => setShowVoiceModelModal(false), []);

  return {
    isStarting,
    isRecording,
    isFinalizing,
    /** True from mic start until the final transcript has been applied. */
    isVoiceActive: isRecording || isFinalizing,
    realtimeText,
    toggleVoice,
    startRecording,
    showVoiceModelModal,
    closeVoiceModelModal,
  };
}
