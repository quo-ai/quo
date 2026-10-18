/**
 * Whisper Service - Offline Speech Recognition
 * Uses whisper.rn for fully offline speech-to-text
 */

// Note: whisper.rn's package "exports" map only defines "./*" subpaths (no "."
// entry), so explicit /index specifiers are required for exports-aware
// resolution (tsc "bundler" + Metro package exports).
import { initWhisper, WhisperContext } from 'whisper.rn/index';
import type { TranscribeResult } from 'whisper.rn/index';
import type {
  AudioStreamConfig,
  AudioStreamData,
  AudioStreamInterface,
} from 'whisper.rn/realtime-transcription/index';
import { base64ToUint8Array } from 'whisper.rn/utils/common';
// @ts-expect-error -- the package ships its typings under the
// 'react-native-live-audio-stream' module name, so this specifier is untyped.
import LiveAudioStreamModule from '@fugood/react-native-audio-pcm-stream';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  documentDirectory,
  getInfoAsync,
  makeDirectoryAsync,
  createDownloadResumable,
  deleteAsync,
  moveAsync,
  DownloadProgressData,
} from 'expo-file-system/legacy';
import { analyticsService } from './analyticsService';

// Available Whisper models from HuggingFace (ggerganov/whisper.cpp)
export interface WhisperModelConfig {
  id: string;
  name: string;
  filename: string;
  url: string;
  size: string;
  /** Approximate file size in bytes — downloads are validated against it. */
  sizeBytes: number;
  description: string;
  supportsMultilingual: boolean;
  recommended?: boolean;
}

type WhisperLanguage = 'auto' | 'en';

const WHISPER_MODELS: WhisperModelConfig[] = [
  {
    id: 'base',
    name: 'Base (Multilingual)',
    filename: 'ggml-base.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
    size: '148 MB',
    sizeBytes: 147_951_465,
    description: 'Recommended. Better accuracy for multilingual voice input.',
    supportsMultilingual: true,
    recommended: true,
  },
  {
    id: 'tiny',
    name: 'Tiny (Multilingual)',
    filename: 'ggml-tiny.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin',
    size: '78 MB',
    sizeBytes: 77_691_713,
    description: 'Fastest multilingual option with lower accuracy.',
    supportsMultilingual: true,
  },
  {
    id: 'small',
    name: 'Small (Multilingual)',
    filename: 'ggml-small.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin',
    size: '488 MB',
    sizeBytes: 487_601_967,
    description: 'Best multilingual accuracy, larger download.',
    supportsMultilingual: true,
  },
  {
    id: 'tiny.en',
    name: 'Tiny (English)',
    filename: 'ggml-tiny.en.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin',
    size: '78 MB',
    sizeBytes: 77_704_715,
    description: 'English only. Not suitable for multilingual voice input.',
    supportsMultilingual: false,
  },
  {
    id: 'base.en',
    name: 'Base (English)',
    filename: 'ggml-base.en.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',
    size: '148 MB',
    sizeBytes: 147_964_211,
    description: 'English only. Not suitable for multilingual voice input.',
    supportsMultilingual: false,
  },
  {
    id: 'small.en',
    name: 'Small (English)',
    filename: 'ggml-small.en.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin',
    size: '488 MB',
    sizeBytes: 487_614_201,
    description: 'English only. Not suitable for multilingual voice input.',
    supportsMultilingual: false,
  },
];

// Default model
const DEFAULT_WHISPER_MODEL = WHISPER_MODELS.find(model => model.id === 'base') || WHISPER_MODELS[0];

const MODEL_STORAGE_KEY = '@whisper_model_id';

// Same rule as the chat models: a file under 95% of the expected size is a
// truncated download and would crash at initWhisper.
const MIN_VALID_SIZE_FRACTION = 0.95;

// --- Realtime capture tuning (16 kHz mono 16-bit PCM) ---
const SAMPLE_RATE = 16000;
const BYTES_PER_SEC = SAMPLE_RATE * 2;
// Preserve the previous 60-second recording cap.
const MAX_RECORDING_MS = 60_000;
// Live preview is latest-wins: at most one pass in flight, and the next one
// starts no sooner than this after the previous finished, so slow devices
// never build a backlog.
const PREVIEW_PAUSE_MS = 1500;
const PREVIEW_TICK_MS = 250;
const PREVIEW_MIN_BYTES = BYTES_PER_SEC; // first preview after 1s of audio
const PREVIEW_MIN_NEW_BYTES = BYTES_PER_SEC / 2;
// Whisper's native window; preview text for completed windows is committed so
// each pass only re-transcribes the current window.
const PREVIEW_WINDOW_BYTES = 30 * BYTES_PER_SEC;
const FINAL_MIN_BYTES = BYTES_PER_SEC * 0.3;
// Small native read buffer (~128ms) so Android's recorder thread notices a
// stop quickly; see RESTART_COOLDOWN_MS.
const MIC_BUFFER_BYTES = 4096;
// Android's LiveAudioStream recorder thread only exits after its current
// blocking read and then releases whatever recorder the module holds — a quick
// stop→start lets it release the NEW recorder. Wait this long after a stop.
const RESTART_COOLDOWN_MS = 500;
// iOS start() fails silently (no promise); treat "no audio at all" as failure.
const NO_AUDIO_TIMEOUT_MS = 3000;

type WhisperStatus = 'idle' | 'downloading' | 'loading' | 'ready' | 'error';
type StatusCallback = (status: WhisperStatus, progress?: number) => void;
type ProgressCallback = (percent: number) => void;

export type RealtimeStopReason = 'max_duration' | 'mic_error';

export interface RealtimeSession {
  /** Receive the accumulated live-preview text. */
  subscribe: (callback: (result: string) => void) => void;
  /**
   * Fires when the session stops itself (60s cap, microphone failure). The
   * UI should then call stop() to collect the final text.
   */
  onAutoStop: (callback: (reason: RealtimeStopReason) => void) => void;
  /**
   * Stop the microphone, run one final transcription over all captured
   * audio and resolve with the final text. Idempotent — every call returns
   * the same promise.
   */
  stop: () => Promise<string>;
}

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

// Strip whisper's non-speech markers ([BLANK_AUDIO], [ silence ], (music)…).
function cleanTranscript(text: string | undefined): string {
  return (text ?? '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\(\s*(?:music|silence|noise|inaudible)[^)]*\)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function joinText(a: string, b: string): string {
  return [a, b].filter(Boolean).join(' ').trim();
}

// Minimal typing for @fugood/react-native-audio-pcm-stream's JS wrapper.
interface LiveAudioStreamApi {
  init: (options: {
    sampleRate: number;
    channels: number;
    bitsPerSample: number;
    audioSource?: number;
    bufferSize?: number;
    wavFile: string;
  }) => Promise<void> | void;
  start: () => void;
  stop: () => Promise<unknown> | void;
  on: (event: 'data', callback: (base64: string) => void) => { remove: () => void } | undefined;
}
const LiveAudioStream = LiveAudioStreamModule as LiveAudioStreamApi;

/**
 * Microphone PCM stream. Replaces whisper.rn's AudioPcmStreamAdapter, which
 * doesn't await LiveAudioStream.init() — on Android init rejects when the
 * AudioRecord can't be created (mic busy, policy), and that failure was
 * silently swallowed. Implements AudioStreamInterface so it stays drop-in
 * compatible with RealtimeTranscriber.
 */
class MicPcmStream implements AudioStreamInterface {
  private initialized = false;
  private recording = false;
  private subscription: { remove: () => void } | undefined;
  private dataCallback?: (data: AudioStreamData) => void;
  private errorCallback?: (error: string) => void;
  private statusCallback?: (isRecording: boolean) => void;

  async initialize(config: AudioStreamConfig): Promise<void> {
    if (this.initialized) await this.release();
    try {
      await LiveAudioStream.init({
        sampleRate: config.sampleRate ?? SAMPLE_RATE,
        channels: config.channels ?? 1,
        bitsPerSample: config.bitsPerSample ?? 16,
        audioSource: config.audioSource ?? 6, // VOICE_RECOGNITION
        bufferSize: config.bufferSize ?? MIC_BUFFER_BYTES,
        wavFile: '',
      });
    } catch (error) {
      throw new Error(`Microphone initialization failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    this.subscription = LiveAudioStream.on('data', this.handleData);
    this.initialized = true;
  }

  async start(): Promise<void> {
    if (!this.initialized) throw new Error('Microphone not initialized');
    if (this.recording) return;
    LiveAudioStream.start();
    this.recording = true;
    this.statusCallback?.(true);
  }

  async stop(): Promise<void> {
    if (!this.recording) return;
    this.recording = false;
    try {
      await LiveAudioStream.stop();
    } finally {
      this.statusCallback?.(false);
    }
  }

  isRecording(): boolean {
    return this.recording;
  }

  onData(callback: (data: AudioStreamData) => void): void {
    this.dataCallback = callback;
  }

  onError(callback: (error: string) => void): void {
    this.errorCallback = callback;
  }

  onStatusChange(callback: (isRecording: boolean) => void): void {
    this.statusCallback = callback;
  }

  async release(): Promise<void> {
    if (this.recording) await this.stop().catch(() => {});
    this.subscription?.remove();
    this.subscription = undefined;
    this.initialized = false;
    this.dataCallback = undefined;
    this.errorCallback = undefined;
    this.statusCallback = undefined;
  }

  private handleData = (base64: string) => {
    if (!this.recording || !this.dataCallback) return;
    try {
      this.dataCallback({
        data: base64ToUint8Array(base64),
        sampleRate: SAMPLE_RATE,
        channels: 1,
        timestamp: Date.now(),
      });
    } catch (error) {
      this.errorCallback?.(error instanceof Error ? error.message : 'Audio processing error');
    }
  };
}

class WhisperService {
  private context: WhisperContext | null = null;
  private isInitialized = false;
  private statusCallback: StatusCallback | null = null;
  private currentStatus: WhisperStatus = 'idle';
  private currentModel: WhisperModelConfig = DEFAULT_WHISPER_MODEL;
  private initializedModelId: string | null = null;
  private transcriptionLanguage: WhisperLanguage = 'auto';
  // Shared in-flight initialize() so concurrent callers can't create (and
  // leak) two whisper contexts.
  private initPromise: Promise<boolean> | null = null;
  // One in-flight download per model; extra callers join it.
  private downloads = new Map<string, Promise<boolean>>();
  private downloadListeners = new Map<string, Set<ProgressCallback>>();
  private activeSession: RealtimeSession | null = null;
  private sessionStarting = false;
  private lastMicStopAt = 0;
  private restorePromise: Promise<void> | null = null;
  private selectionChanged = false;

  /**
   * Set callback for status updates
   */
  setStatusCallback(callback: StatusCallback | null) {
    this.statusCallback = callback;
  }

  private updateStatus(status: WhisperStatus, progress?: number) {
    this.currentStatus = status;
    this.statusCallback?.(status, progress);
  }

  /** Restore the persisted model choice once (lazy; awaited by async entry points). */
  private restoreSelectedModel(): Promise<void> {
    if (!this.restorePromise) {
      this.restorePromise = AsyncStorage.getItem(MODEL_STORAGE_KEY)
        .then(id => {
          // An explicit selection made before the read finished wins.
          if (!id || this.selectionChanged) return;
          const model = WHISPER_MODELS.find(m => m.id === id);
          if (model) this.currentModel = model;
        })
        .catch(() => {});
    }
    return this.restorePromise;
  }

  /**
   * Get the model file path for a specific model
   */
  private getModelPath(model?: WhisperModelConfig): string {
    const m = model || this.currentModel;
    return `${documentDirectory}whisper/${m.filename}`;
  }

  /**
   * Set the current model to use (persisted across launches)
   */
  setCurrentModel(modelId: string) {
    const model = WHISPER_MODELS.find(m => m.id === modelId);
    if (model) {
      this.currentModel = model;
      this.selectionChanged = true;
      AsyncStorage.setItem(MODEL_STORAGE_KEY, model.id).catch(() => {});
    }
  }

  setTranscriptionLanguage(language: WhisperLanguage) {
    this.transcriptionLanguage = language;
  }

  private getActiveTranscriptionLanguage(): string {
    return this.currentModel.supportsMultilingual ? this.transcriptionLanguage : 'en';
  }

  getTranscriptionLanguage(): string {
    return this.getActiveTranscriptionLanguage();
  }

  /**
   * Get all available models
   */
  getAvailableModels(): WhisperModelConfig[] {
    return WHISPER_MODELS;
  }

  /**
   * Get current model
   */
  getCurrentModel(): WhisperModelConfig {
    return this.currentModel;
  }

  /**
   * Check if a specific model is downloaded
   */
  async isModelDownloaded(modelId?: string): Promise<boolean> {
    try {
      if (!modelId) await this.restoreSelectedModel();
      const model = modelId ? WHISPER_MODELS.find(m => m.id === modelId) : this.currentModel;
      if (!model) return false;
      const modelPath = this.getModelPath(model);
      const info = await getInfoAsync(modelPath);
      return info.exists && typeof info.size === 'number' && info.size >= model.sizeBytes * MIN_VALID_SIZE_FRACTION;
    } catch {
      return false;
    }
  }

  /**
   * Check download status of all models
   */
  async checkAllModelsStatus(): Promise<Record<string, boolean>> {
    const status: Record<string, boolean> = {};
    for (const model of WHISPER_MODELS) {
      status[model.id] = await this.isModelDownloaded(model.id);
    }
    return status;
  }

  /**
   * Download a Whisper model (defaults to the current one). Progress is
   * reported per call, so parallel downloads of different models don't
   * overwrite each other's progress. Concurrent calls for the same model
   * share one download.
   */
  downloadModel(modelId?: string, onProgress?: ProgressCallback): Promise<boolean> {
    const model = (modelId && WHISPER_MODELS.find(m => m.id === modelId)) || this.currentModel;

    let listeners = this.downloadListeners.get(model.id);
    if (!listeners) {
      listeners = new Set();
      this.downloadListeners.set(model.id, listeners);
    }
    if (onProgress) listeners.add(onProgress);

    let download = this.downloads.get(model.id);
    if (!download) {
      download = this.runDownload(model).finally(() => {
        this.downloads.delete(model.id);
        this.downloadListeners.delete(model.id);
      });
      this.downloads.set(model.id, download);
    }
    return download;
  }

  private async runDownload(model: WhisperModelConfig): Promise<boolean> {
    const emitProgress = (percent: number) => {
      if (!Number.isFinite(percent)) return;
      const clamped = Math.max(0, Math.min(100, percent));
      this.downloadListeners.get(model.id)?.forEach(listener => listener(clamped));
      this.statusCallback?.('downloading', clamped);
    };

    const modelPath = this.getModelPath(model);
    // Download to a .part file and only move it into place once validated,
    // so an interrupted download can never be mistaken for a model.
    const partPath = `${modelPath}.part`;

    try {
      this.updateStatus('downloading', 0);

      const modelDir = `${documentDirectory}whisper`;
      const dirInfo = await getInfoAsync(modelDir);
      if (!dirInfo.exists) {
        await makeDirectoryAsync(modelDir, { intermediates: true });
      }

      // Check if already downloaded
      if (await this.isModelDownloaded(model.id)) {
        emitProgress(100);
        this.updateStatus('idle');
        return true;
      }

      // Clear truncated leftovers from earlier attempts.
      await deleteAsync(partPath, { idempotent: true }).catch(() => {});
      await deleteAsync(modelPath, { idempotent: true }).catch(() => {});

      const downloadResumable = createDownloadResumable(
        model.url,
        partPath,
        {},
        (downloadProgress: DownloadProgressData) => {
          // totalBytesExpectedToWrite is -1 when the server omits
          // Content-Length — fall back to the catalog size.
          const total = downloadProgress.totalBytesExpectedToWrite > 0
            ? downloadProgress.totalBytesExpectedToWrite
            : model.sizeBytes;
          emitProgress(Math.min(99, (downloadProgress.totalBytesWritten / total) * 100));
        }
      );

      const result = await downloadResumable.downloadAsync();
      if (!result || result.status !== 200) {
        throw new Error(`Download failed (HTTP ${result?.status ?? 'no response'})`);
      }

      const info = await getInfoAsync(partPath);
      const minBytes = model.sizeBytes * MIN_VALID_SIZE_FRACTION;
      if (!info.exists || typeof info.size !== 'number' || info.size < minBytes) {
        throw new Error(`Download incomplete (${info.exists ? info.size : 0} of ~${model.sizeBytes} bytes)`);
      }

      await moveAsync({ from: partPath, to: modelPath });
      emitProgress(100);
      this.updateStatus('idle');
      return true;
    } catch (error) {
      console.error('[WhisperService] Download error:', error);
      await deleteAsync(partPath, { idempotent: true }).catch(() => {});
      this.updateStatus('error');
      return false;
    }
  }

  /**
   * Initialize Whisper context. Concurrent callers share one in-flight
   * initialization.
   */
  initialize(): Promise<boolean> {
    if (!this.initPromise) {
      this.initPromise = this.doInitialize().finally(() => {
        this.initPromise = null;
      });
    }
    return this.initPromise;
  }

  private async doInitialize(): Promise<boolean> {
    await this.restoreSelectedModel();
    const model = this.currentModel;

    if (this.isInitialized && this.context && this.initializedModelId === model.id) {
      return true;
    }

    if (this.context && this.initializedModelId !== model.id) {
      if (this.activeSession) await this.activeSession.stop().catch(() => '');
      await this.releaseContext();
    }

    try {
      // Check if model exists
      if (!(await this.isModelDownloaded(model.id))) {
        const downloaded = await this.downloadModel(model.id);
        if (!downloaded) {
          return false;
        }
      }

      this.updateStatus('loading');

      this.context = await initWhisper({
        filePath: this.getModelPath(model),
      });

      this.isInitialized = true;
      this.initializedModelId = model.id;
      this.updateStatus('ready');
      return true;
    } catch (error) {
      console.error('[WhisperService] Initialization error:', error);
      this.updateStatus('error');
      return false;
    }
  }

  /**
   * Transcribe audio file
   */
  async transcribe(audioPath: string): Promise<string> {
    if (!this.context) {
      throw new Error('Whisper not initialized');
    }

    try {
      const language = this.getActiveTranscriptionLanguage();
      void analyticsService.trackVoiceInputStarted({
        source: 'audio_file',
        voice_model_id: this.currentModel.id,
        voice_language: language,
        multilingual: this.currentModel.supportsMultilingual,
      });

      const { promise } = this.context.transcribe(audioPath, {
        language,
        maxLen: 0,
        translate: false,
      });

      const { result } = await promise;
      const text = result.trim();
      void analyticsService.trackVoiceInputCompleted({
        source: 'audio_file',
        voice_model_id: this.currentModel.id,
        voice_language: language,
        char_count: text.length,
      });
      return text;
    } catch (error) {
      console.error('[WhisperService] Transcription error:', error);
      void analyticsService.trackVoiceInputFailed({
        source: 'audio_file',
        voice_model_id: this.currentModel.id,
        voice_language: this.getActiveTranscriptionLanguage(),
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Start realtime transcription from the microphone.
   *
   * Live preview runs latest-wins (never more than one pass in flight, no
   * queue). stop() halts the mic, runs one final pass over ALL captured audio
   * and resolves with that text — so the last seconds spoken are never lost
   * to a dropped queue item or an in-flight preview.
   */
  async startRealtimeTranscription(): Promise<RealtimeSession> {
    this.sessionStarting = true;
    try {
      return await this.createRealtimeSession();
    } finally {
      this.sessionStarting = false;
    }
  }

  private async createRealtimeSession(): Promise<RealtimeSession> {
    // Only one mic session at a time.
    if (this.activeSession) {
      await this.activeSession.stop().catch(() => '');
    }
    const sinceStop = Date.now() - this.lastMicStopAt;
    if (sinceStop < RESTART_COOLDOWN_MS) {
      await delay(RESTART_COOLDOWN_MS - sinceStop);
    }

    // The context may have been freed (app backgrounded) since the caller
    // checked isReady() — reload rather than fail.
    if (!this.isReady() && !(await this.initialize())) {
      throw new Error('Whisper not initialized');
    }
    const context = this.context;
    if (!context) {
      throw new Error('Whisper not initialized');
    }

    const model = this.currentModel;
    const language = this.getActiveTranscriptionLanguage();
    void analyticsService.trackVoiceInputStarted({
      source: 'realtime',
      voice_model_id: model.id,
      voice_language: language,
      multilingual: model.supportsMultilingual,
    });
    const transcribeOptions = { language, maxLen: 0, translate: false };

    // Raw PCM16 captured so far — the final pass transcribes all of it
    // (≤60s ≈ 1.9MB).
    const chunks: Uint8Array[] = [];
    let capturedBytes = 0;

    let resultCallback: ((result: string) => void) | null = null;
    let autoStopCallback: ((reason: RealtimeStopReason) => void) | null = null;

    let committedText = '';
    let latestText = '';
    let windowStart = 0;
    let previewedBytes = 0;
    let lastPreviewEndedAt = 0;
    let inFlight: { stop: () => Promise<void>; promise: Promise<TranscribeResult> } | null = null;
    let previewPromise: Promise<void> | null = null;
    let stopPromise: Promise<string> | null = null;
    let stopping = false;

    let previewTimer: ReturnType<typeof setInterval> | null = null;
    let maxDurationTimer: ReturnType<typeof setTimeout> | null = null;
    let noAudioTimer: ReturnType<typeof setTimeout> | null = null;

    const collectPcm = (from: number, to: number): ArrayBuffer => {
      const length = (to - from) & ~1; // whole 16-bit samples
      const out = new Uint8Array(length);
      const end = from + length;
      let position = 0;
      let offset = 0;
      for (const chunk of chunks) {
        const chunkStart = position;
        const chunkEnd = position + chunk.length;
        position = chunkEnd;
        if (chunkEnd <= from) continue;
        if (chunkStart >= end) break;
        const s = Math.max(from, chunkStart) - chunkStart;
        const e = Math.min(end, chunkEnd) - chunkStart;
        out.set(chunk.subarray(s, e), offset);
        offset += e - s;
      }
      return out.buffer;
    };

    const runTranscription = async (pcm: ArrayBuffer): Promise<string> => {
      const task = context.transcribeData(pcm, transcribeOptions);
      inFlight = task;
      try {
        const { result } = await task.promise;
        return cleanTranscript(result);
      } finally {
        inFlight = null;
      }
    };

    const runPreview = async () => {
      const total = capturedBytes;
      const windowEnd = Math.min(total, windowStart + PREVIEW_WINDOW_BYTES);
      const closesWindow = total >= windowStart + PREVIEW_WINDOW_BYTES;
      previewedBytes = total;
      try {
        const text = await runTranscription(collectPcm(windowStart, windowEnd));
        if (stopping) return;
        if (closesWindow) {
          committedText = joinText(committedText, text);
          windowStart = windowEnd;
          latestText = committedText;
        } else {
          latestText = joinText(committedText, text);
        }
        if (latestText) resultCallback?.(latestText);
      } catch (error) {
        if (!stopping) console.warn('[WhisperService] Preview transcription failed:', error);
      } finally {
        lastPreviewEndedAt = Date.now();
      }
    };

    const tick = () => {
      if (stopping || previewPromise) return;
      if (capturedBytes < PREVIEW_MIN_BYTES) return;
      if (capturedBytes - previewedBytes < PREVIEW_MIN_NEW_BYTES) return;
      if (Date.now() - lastPreviewEndedAt < PREVIEW_PAUSE_MS) return;
      previewPromise = runPreview().finally(() => {
        previewPromise = null;
      });
    };

    const mic = new MicPcmStream();

    const finish = (): Promise<string> => {
      if (stopPromise) return stopPromise;
      stopping = true;
      if (previewTimer) clearInterval(previewTimer);
      if (maxDurationTimer) clearTimeout(maxDurationTimer);
      if (noAudioTimer) clearTimeout(noAudioTimer);

      stopPromise = (async () => {
        try {
          await mic.stop();
        } catch (error) {
          console.warn('[WhisperService] Error stopping microphone:', error);
        }
        this.lastMicStopAt = Date.now();

        // The context runs one job at a time: abort the live preview first.
        const pending = inFlight as { stop: () => Promise<void> } | null;
        if (pending) await pending.stop().catch(() => {});
        if (previewPromise) await previewPromise.catch(() => {});

        let finalText = latestText;
        const usableBytes = capturedBytes & ~1;
        if (usableBytes >= FINAL_MIN_BYTES) {
          try {
            finalText = (await runTranscription(collectPcm(0, usableBytes))) || latestText;
          } catch (error) {
            console.error('[WhisperService] Final transcription failed:', error);
          }
        }

        await mic.release().catch(() => {});
        chunks.length = 0;
        if (this.activeSession === session) this.activeSession = null;
        this.onSessionEnded();
        return finalText;
      })();
      return stopPromise;
    };

    const autoStop = (reason: RealtimeStopReason) => {
      if (stopping) return;
      void finish();
      autoStopCallback?.(reason);
    };

    mic.onData(({ data }) => {
      if (stopping) return;
      chunks.push(data);
      capturedBytes += data.length;
    });
    mic.onError((error) => {
      console.error('[WhisperService] Microphone error:', error);
      autoStop('mic_error');
    });
    mic.onStatusChange(() => {});

    const session: RealtimeSession = {
      stop: finish,
      subscribe: (callback) => {
        resultCallback = callback;
      },
      onAutoStop: (callback) => {
        autoStopCallback = callback;
      },
    };

    try {
      await mic.initialize({
        sampleRate: SAMPLE_RATE,
        channels: 1,
        bitsPerSample: 16,
        audioSource: 6,
        bufferSize: MIC_BUFFER_BYTES,
      });
      await mic.start();
    } catch (error) {
      void analyticsService.trackVoiceInputFailed({
        source: 'realtime',
        voice_model_id: model.id,
        voice_language: language,
        error: error instanceof Error ? error.message : String(error),
      });
      await mic.release().catch(() => {});
      this.lastMicStopAt = Date.now();
      throw error;
    }

    this.activeSession = session;
    previewTimer = setInterval(tick, PREVIEW_TICK_MS);
    maxDurationTimer = setTimeout(() => autoStop('max_duration'), MAX_RECORDING_MS);
    noAudioTimer = setTimeout(() => {
      if (capturedBytes === 0) {
        console.error('[WhisperService] No audio received from microphone');
        autoStop('mic_error');
      }
    }, NO_AUDIO_TIMEOUT_MS);

    return session;
  }

  /** True while a realtime microphone session is running or finalizing. */
  isRecording(): boolean {
    return this.activeSession !== null || this.sessionStarting;
  }

  // A session that finished while the app is backgrounded (e.g. the stop was
  // triggered by backgrounding) frees the context right away.
  private onSessionEnded() {
    if (AppState.currentState === 'background') {
      void this.releaseIfIdle();
    }
  }

  /**
   * Get current status
   */
  getStatus(): WhisperStatus {
    return this.currentStatus;
  }

  /**
   * Check if ready for transcription
   */
  isReady(): boolean {
    return this.isInitialized && this.context !== null && this.initializedModelId === this.currentModel.id;
  }

  /**
   * Free the whisper context (150–500MB) unless it's in use. Used when the
   * app is backgrounded; it reloads lazily on next voice input.
   */
  async releaseIfIdle(): Promise<void> {
    if (this.activeSession || this.sessionStarting || this.initPromise) return;
    await this.releaseContext();
  }

  /**
   * Release resources. Waits for an in-flight initialization and finishes an
   * active recording first — releasing a context mid-transcription crashes.
   */
  async release(): Promise<void> {
    if (this.initPromise) await this.initPromise.catch(() => false);
    if (this.activeSession) await this.activeSession.stop().catch(() => '');
    await this.releaseContext();
  }

  private async releaseContext(): Promise<void> {
    if (this.context) {
      const context = this.context;
      this.context = null;
      this.isInitialized = false;
      this.initializedModelId = null;
      try {
        await context.release();
      } catch (error) {
        console.error('[WhisperService] Release error:', error);
      }
      this.updateStatus('idle');
    }
  }

  /**
   * Delete the downloaded model
   */
  async deleteModel(): Promise<void> {
    await this.deleteModelById(this.currentModel.id);
  }

  /**
   * Get model info
   */
  getModelInfo() {
    return this.currentModel;
  }

  /**
   * Delete a specific model
   */
  async deleteModelById(modelId: string): Promise<void> {
    const model = WHISPER_MODELS.find(m => m.id === modelId);
    if (!model) return;

    // If deleting the loaded model, release context first
    if (model.id === this.currentModel.id || model.id === this.initializedModelId) {
      await this.release();
    }

    try {
      const modelPath = this.getModelPath(model);
      await deleteAsync(modelPath, { idempotent: true });
      await deleteAsync(`${modelPath}.part`, { idempotent: true });
    } catch {
      // Ignore delete errors
    }
  }
}

export const whisperService = new WhisperService();
export { WHISPER_MODELS };
