import { Platform } from 'react-native';
import * as Speech from 'expo-speech';
import { documentDirectory, deleteAsync } from 'expo-file-system/legacy';
import { analyticsService } from './analyticsService';

// Read Aloud via the device's system text-to-speech voices: instant, no
// download, works offline with the voices already on the phone, and reads
// the whole message. The previous llama.cpp OuteTTS pipeline (535 MB of
// downloads, ~1 minute of CPU per spoken sentence) was removed — see git
// history if llama.rn ever gains a TTS path fast enough to revisit.

export type TtsStatus = 'idle' | 'playing';
type TtsListener = (status: TtsStatus) => void;

// System engines cap input length (Android ~4000 chars). Stay under it and
// cut at a sentence boundary.
const MAX_SPEAK_CHARS = Math.min(3900, Speech.maxSpeechInputLength || 3900);

class TTSService {
  private static instance: TTSService;
  private status: TtsStatus = 'idle';
  private listeners = new Set<TtsListener>();
  private cleanedUpLegacyModels = false;
  // Incremented per utterance. Speech.stop() fires the previous utterance's
  // onStopped asynchronously — often after the next one has started — so
  // callbacks from a stale utterance must not flip the status to idle.
  private utteranceId = 0;

  static getInstance(): TTSService {
    if (!TTSService.instance) {
      TTSService.instance = new TTSService();
    }
    return TTSService.instance;
  }

  addListener(listener: TtsListener): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  getStatus(): TtsStatus {
    return this.status;
  }

  isBusy(): boolean {
    return this.status !== 'idle';
  }

  private setStatus(status: TtsStatus): void {
    this.status = status;
    this.listeners.forEach(listener => listener(status));
  }

  /** Remove the OuteTTS/WavTokenizer downloads from the removed pipeline. */
  private cleanupLegacyModels(): void {
    if (this.cleanedUpLegacyModels || Platform.OS === 'web') return;
    this.cleanedUpLegacyModels = true;
    void deleteAsync(`${documentDirectory}models/tts/`, { idempotent: true }).catch(() => {});
  }

  /**
   * Prepare text for speech: strip markdown/code/reasoning artifacts and cap
   * length at a sentence boundary.
   */
  private cleanForSpeech(text: string): string {
    let clean = text
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/```[\s\S]*?```/g, ' Code omitted. ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[*_#>|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (clean.length > MAX_SPEAK_CHARS) {
      const slice = clean.slice(0, MAX_SPEAK_CHARS);
      const lastSentenceEnd = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '));
      clean = lastSentenceEnd > MAX_SPEAK_CHARS / 2 ? slice.slice(0, lastSentenceEnd + 1) : slice;
    }
    return clean;
  }

  /**
   * Speak the text with the system voice. Resolves true once speech starts.
   */
  async speak(text: string): Promise<boolean> {
    if (Platform.OS === 'web') return false;
    this.cleanupLegacyModels();

    const clean = this.cleanForSpeech(text);
    if (!clean) return false;

    await this.stop();
    const utterance = ++this.utteranceId;
    const isCurrent = () => utterance === this.utteranceId;
    const finishUtterance = () => {
      if (isCurrent()) this.setStatus('idle');
    };

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const settle = (ok: boolean) => {
        if (!settled) {
          settled = true;
          resolve(ok);
        }
      };

      try {
        this.setStatus('playing');
        Speech.speak(clean, {
          onStart: () => {
            void analyticsService.track('tts_speak_started', {
              chars: clean.length,
              engine: 'system',
            });
            settle(true);
          },
          onDone: () => {
            finishUtterance();
            settle(true);
          },
          onStopped: () => {
            finishUtterance();
            settle(true);
          },
          onError: (error) => {
            finishUtterance();
            void analyticsService.track('tts_speak_failed', {
              error: String(error instanceof Error ? error.message : error).slice(0, 100),
              engine: 'system',
            });
            settle(false);
          },
        });
        // Engines that never fire onStart shouldn't hang the caller.
        setTimeout(() => settle(isCurrent() && this.status === 'playing'), 4000);
      } catch (error) {
        finishUtterance();
        void analyticsService.track('tts_speak_failed', {
          error: String(error instanceof Error ? error.message : error).slice(0, 100),
          engine: 'system',
        });
        settle(false);
      }
    });
  }

  /** Stop any ongoing speech. */
  async stop(): Promise<void> {
    // Invalidate the current utterance so its late callbacks are ignored.
    this.utteranceId++;
    try {
      await Speech.stop();
    } catch {
      // Best effort — the engine may already be idle.
    }
    this.setStatus('idle');
  }

  /** API kept for callers that released the old model-based engine. */
  async release(): Promise<void> {
    await this.stop();
  }
}

export const ttsService = TTSService.getInstance();
