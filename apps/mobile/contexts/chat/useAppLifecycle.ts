import { useEffect, useRef, MutableRefObject } from 'react';
import { AppState, InteractionManager } from 'react-native';
import { notificationService } from '@/services/notifications';
import { downloadService, DownloadState } from '@/services/downloadService';
import { recallService } from '@/services/recallService';
import { ttsService } from '@/services/ttsService';
import { whisperService } from '@/services/whisperService';
import { analyticsService } from '@/services/analyticsService';

// App-state tracking for background generation notifications, plus one-time
// notification/download-service initialization. Returns a ref that reports
// whether the app is currently backgrounded.
export function useAppLifecycle({
  isGeneratingRef,
  downloadStateRef,
}: {
  isGeneratingRef: MutableRefObject<boolean>;
  downloadStateRef: MutableRefObject<DownloadState>;
}) {
  // Track if app is in background for generation notifications
  const isInBackgroundRef = useRef(false);

  useEffect(() => {
    notificationService.initialize();
    const downloadInitTask = InteractionManager.runAfterInteractions(() => {
      downloadService.initialize().catch(() => {});
    });

    // Track app state for background generation notifications
    const appStateSubscription = AppState.addEventListener('change', (nextAppState) => {
      const wasBackground = isInBackgroundRef.current;
      const isBackground = nextAppState !== 'active';
      isInBackgroundRef.current = isBackground;

      if (isBackground && downloadStateRef.current.status === 'downloading') {
        void analyticsService.trackModelDownloadBackgrounded({
          model_id: downloadStateRef.current.modelId,
          progress: Math.round(downloadStateRef.current.progress),
          bytes_downloaded: downloadStateRef.current.bytesDownloaded,
          bytes_total: downloadStateRef.current.totalBytes,
        });
      }

      if (isBackground) {
        // Free the heavyweight optional AI contexts while backgrounded (up to
        // ~850MB RAM between them, plus 150-500MB for Whisper); they reload
        // lazily on next use. Skip any that are actively working to avoid
        // native teardown races — an active voice session is stopped by
        // ChatInput and whisperService releases itself once it finalizes.
        if (!ttsService.isBusy()) {
          void ttsService.release();
        }
        if (!whisperService.isRecording()) {
          void whisperService.releaseIfIdle();
        }
        if (!recallService.isBusy()) {
          void recallService.release();
        }
      }

      if (isBackground && isGeneratingRef.current) {
        // App went to background while generating — show persistent notification
        // so Android keeps the process alive (generation continues running).
        // On iOS this is a no-op: the OS suspends the app, generation pauses,
        // and resumes when the app returns to the foreground — llama.rn
        // tolerates the suspension.
        notificationService.showOngoingGenerationNotification().catch(() => {});
      } else if (!isBackground && wasBackground) {
        // User returned to the app — dismiss the ongoing indicator
        notificationService.dismissOngoingGenerationNotification().catch(() => {});
      }
    });

    return () => {
      downloadInitTask.cancel();
      appStateSubscription.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // No dependencies - subscribe once on mount

  return { isInBackgroundRef };
}
