import { Platform } from 'react-native';
import {
  getInfoAsync,
  getFreeDiskStorageAsync,
  makeDirectoryAsync,
  deleteAsync,
  moveAsync,
} from 'expo-file-system/legacy';
import { ModelConfig, getModelById } from '@/constants/models';
import { CustomModelConfig, customModelService } from './customModelService';
import { analyticsService } from './analyticsService';
import { MODELS_DIR, claimTempPath, sweepStaleTempFiles } from './fileDownload';
import { getModelPath, getModelTempPath, isModelFileValid } from './llm/paths';

// Conditional import for background downloader - only available on native platforms
type BgDownloader = typeof import('@kesha-antonov/react-native-background-downloader');
type DownloadTask = import('@kesha-antonov/react-native-background-downloader').DownloadTask;
let createDownloadTask: BgDownloader['createDownloadTask'] | null = null;
let getExistingDownloadTasks: BgDownloader['getExistingDownloadTasks'] | null = null;
let completeHandler: BgDownloader['completeHandler'] | null = null;
let setDownloaderConfig: BgDownloader['setConfig'] | null = null;

if (Platform.OS !== 'web') {
  try {
    const bgDownloader = require('@kesha-antonov/react-native-background-downloader');
    createDownloadTask = bgDownloader.createDownloadTask;
    getExistingDownloadTasks = bgDownloader.getExistingDownloadTasks;
    completeHandler = bgDownloader.completeHandler;
    setDownloaderConfig = bgDownloader.setConfig;
  } catch (e) {
    console.warn('Background downloader not available');
  }
}

export type DownloadStatus = 'idle' | 'downloading' | 'paused' | 'completed' | 'failed';

export interface DownloadState {
  status: DownloadStatus;
  progress: number;
  modelId: string | null;
  modelName: string | null;
  error: string | null;
  bytesDownloaded: number;
  totalBytes: number;
  retryNumber: number;
  failureStage: string | null;
  canRetry: boolean;
  /**
   * True when this download was picked back up from a previous app session
   * (no startDownload caller is waiting on it) — consumers own the
   * post-download flow (load the model if it is the selected one).
   */
  reattached: boolean;
}

type DownloadModel = ModelConfig | CustomModelConfig;

interface TaskContext {
  model: DownloadModel;
  tempPath: string;
  finalPath: string;
  /** Session token: events from a task superseded by cancel/restart are ignored. */
  generation: number;
  retryNumber: number;
  startedAt: number;
  reattached: boolean;
  onProgress?: (progress: number) => void;
  /** Resolve the caller's promise; true only when a valid model is on disk. */
  settle: (ok: boolean) => void;
  /** Schedule an automatic retry after a recoverable error; absent = never. */
  scheduleRetry?: () => void;
}

type DownloadListener = (state: DownloadState) => void;

async function resolveDownloadModel(id: string): Promise<DownloadModel | undefined> {
  const builtIn = getModelById(id);
  if (builtIn) return builtIn;
  if (customModelService.isCustomModel(id)) {
    return customModelService.getModelById(id);
  }
  return undefined;
}

// The background downloader strips `file://` from task destinations
// (reattached tasks report a bare path), so only ever use it as a fallback.
function toFileUri(path: string): string {
  return path.startsWith('file://') ? path : `file://${path}`;
}

function getDownloadAnalyticsParams(model: ModelConfig | CustomModelConfig) {
  return {
    model_id: model.id,
    size_bytes: model.sizeBytes,
    model_size_mb: bytesToMb(model.sizeBytes),
    has_vision: Boolean(model.hasVision),
    is_custom: Boolean((model as CustomModelConfig).isCustom),
  };
}

function bytesToMb(bytes: number | null | undefined): number | undefined {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return undefined;
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}

function formatStorage(bytes: number): string {
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function getDownloadFailureStage(error: string | null | undefined, errorCode?: number): string {
  const normalized = (error || '').toLowerCase();
  if (normalized.includes('space') || normalized.includes('storage')) return 'preflight_storage';
  if (normalized.includes('network') || normalized.includes('timed out') || normalized.includes('timeout')) return 'transfer_network';
  if (normalized.includes('http') || normalized.includes('server')) return 'transfer_http';
  if (typeof errorCode === 'number') return 'transfer_native';
  return 'transfer';
}

function isRecoverableDownloadError(error: string | null | undefined, errorCode?: number): boolean {
  const normalized = (error || '').toLowerCase();
  if (normalized.includes('space') || normalized.includes('storage')) return false;
  if (normalized.includes('permission') || normalized.includes('denied')) return false;
  if (normalized.includes('cancel')) return false;
  if (typeof errorCode === 'number' && errorCode >= 400 && errorCode < 500) return false;
  return true;
}

function getUserDownloadError(error: string | null | undefined): string {
  const normalized = (error || '').toLowerCase();
  if (normalized.includes('network') || normalized.includes('timed out') || normalized.includes('timeout')) {
    return 'Download paused by a connection problem. Check your internet connection and try again.';
  }
  return error || 'Download failed. Please try again.';
}

class DownloadService {
  private static instance: DownloadService;
  private currentTask: DownloadTask | null = null;
  private currentState: DownloadState = {
    status: 'idle',
    progress: 0,
    modelId: null,
    modelName: null,
    error: null,
    bytesDownloaded: 0,
    totalBytes: 0,
    retryNumber: 0,
    failureStage: null,
    canRetry: false,
    reattached: false,
  };
  private listeners: Set<DownloadListener> = new Set();
  private lastProgressUpdate = 0;
  private readonly PROGRESS_THROTTLE = 250; // Update UI max 4 times per second
  private readonly MAX_AUTO_RETRIES = 1;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  // Bumped by every start/cancel; task events carrying an older token are
  // ignored, so a cancelled task (or its pending retry) can never revive.
  private activeGeneration = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  // Resolver of the in-flight startDownload promise, settled false on cancel.
  private pendingSettle: ((ok: boolean) => void) | null = null;
  private releaseTempPath: (() => void) | null = null;

  private constructor() {
  }

  static getInstance(): DownloadService {
    if (!DownloadService.instance) {
      DownloadService.instance = new DownloadService();
    }
    return DownloadService.instance;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) {
      await this.initPromise;
      return;
    }

    this.initPromise = (async () => {
      try {
        if (setDownloaderConfig) {
          // Large model downloads do not benefit from ultra-frequent progress events.
          // Relaxing native progress emission reduces bridge pressure and ANR risk.
          setDownloaderConfig({
            progressInterval: 1500,
            progressMinBytes: 4 * 1024 * 1024,
            // v4 removed the per-task isNotificationVisible option; the
            // system download notification is now enabled globally here
            // (defaults to false). Android-only: iOS has no system download
            // UI — in-app progress covers it there.
            showNotificationsEnabled: true,
          });
        }

        const activeTempPath = await this.reattachDownloads();
        // Partial downloads from earlier sessions (terminal failures, kills
        // mid-copy) are multi-GB dead weight — drop everything not owned by
        // the reattached task or an in-flight operation.
        await sweepStaleTempFiles(activeTempPath ? [activeTempPath] : []);
      } finally {
        this.initialized = true;
        this.initPromise = null;
      }
    })();

    await this.initPromise;
  }

  /**
   * Promote a finished temp download to its final path. Throws (and deletes
   * the temp file) unless the body is a valid model file — at least 95% of
   * the catalog size (GGUF magic for unknown-size custom models) and, when
   * the server reported a total, no shorter than it. A captive-portal HTML
   * page or truncated body must fail loudly instead of becoming "completed".
   */
  private async finalizeDownloadedFile(
    model: DownloadModel,
    tempPath: string,
    finalPath: string,
    bytesTotal: number,
  ): Promise<void> {
    const info = await getInfoAsync(tempPath);
    const size = info.exists && 'size' in info ? info.size : 0;
    const complete = bytesTotal > 0 ? size >= bytesTotal : true;
    if (!complete || !(await isModelFileValid(model, tempPath))) {
      await deleteAsync(tempPath, { idempotent: true }).catch(() => {});
      const expected = bytesTotal > 0 ? bytesTotal : model.sizeBytes;
      throw new Error(
        expected > 0
          ? `Downloaded file is incomplete or invalid (${size} of ${expected} bytes)`
          : 'Downloaded file is not a valid GGUF model',
      );
    }
    // iOS refuses to move onto an existing file.
    await deleteAsync(finalPath, { idempotent: true }).catch(() => {});
    await moveAsync({ from: tempPath, to: finalPath });
  }

  /**
   * Reattach to downloads that were running when the app was killed.
   * Returns the temp path of the task that is still being written (kept by
   * the startup sweep), if any.
   */
  private async reattachDownloads(): Promise<string | null> {
    if (!getExistingDownloadTasks) return null;

    let activeTempPath: string | null = null;
    try {
      const lostTasks = await getExistingDownloadTasks();
      if (!lostTasks || lostTasks.length === 0) return null;

      // Prefer a finished task, then a live one; the service tracks one
      // download at a time, so any others are finalized silently (DONE) or
      // stopped and cleaned up.
      const rank = (task: DownloadTask) =>
        task.state === 'DONE' ? 0 : task.state === 'DOWNLOADING' || task.state === 'PENDING' ? 1 : task.state === 'PAUSED' ? 2 : 3;
      const ordered = [...lostTasks].sort((a, b) => rank(a) - rank(b));
      let primaryHandled = false;

      for (const task of ordered) {
        const model = await resolveDownloadModel(task.id);
        if (!model) {
          // Model no longer exists (custom model removed): nothing to load.
          await this.discardTask(task, task.destination ? toFileUri(task.destination) : null);
          continue;
        }
        // Rebuild paths from the model — task.destination comes back without
        // the file:// scheme and getInfoAsync cannot stat a bare path.
        const tempPath = getModelTempPath(model);
        const finalPath = getModelPath(model);

        if (task.state === 'FAILED' || task.state === 'STOPPED') {
          await this.discardTask(task, tempPath);
          continue;
        }

        if (primaryHandled) {
          if (task.state === 'DONE') {
            await this.finalizeDownloadedFile(model, tempPath, finalPath, task.bytesTotal).catch(() => {});
            if (completeHandler) completeHandler(task.id);
          } else {
            await this.discardTask(task, tempPath);
          }
          continue;
        }
        primaryHandled = true;
        this.attachReattachedTask(task, model, tempPath, finalPath);
        if (task.state !== 'DONE') activeTempPath = tempPath;
      }
    } catch (error) {
      console.error('Failed to check for existing downloads:', error);
    }
    return activeTempPath;
  }

  private async discardTask(task: DownloadTask, tempPath: string | null): Promise<void> {
    try {
      await task.stop();
    } catch {}
    if (tempPath) await deleteAsync(tempPath, { idempotent: true }).catch(() => {});
  }

  private attachReattachedTask(
    task: DownloadTask,
    model: DownloadModel,
    tempPath: string,
    finalPath: string,
  ): void {
    const generation = ++this.activeGeneration;
    this.currentTask = task;
    this.releaseTempPath?.();
    this.releaseTempPath = claimTempPath(tempPath);
    const bytesTotal = task.bytesTotal > 0 ? task.bytesTotal : model.sizeBytes;
    const ctx: TaskContext = {
      model,
      tempPath,
      finalPath,
      generation,
      retryNumber: 0,
      startedAt: Date.now(),
      reattached: true,
      settle: () => {},
    };

    this.updateState({
      status: task.state === 'PAUSED' ? 'paused' : 'downloading',
      progress: task.state === 'DONE' ? 100 : bytesTotal > 0 ? (task.bytesDownloaded / bytesTotal) * 100 : 0,
      modelId: model.id,
      modelName: model.name,
      error: null,
      bytesDownloaded: task.bytesDownloaded,
      totalBytes: bytesTotal,
      retryNumber: 0,
      failureStage: null,
      canRetry: true,
      reattached: true,
    });

    if (task.state === 'DONE') {
      // Finished while the app was dead: the done event already fired into
      // the void, so finalize now instead of waiting forever.
      setTimeout(() => {
        void this.completeTask(ctx, task.bytesDownloaded, task.bytesTotal);
      }, 0);
      return;
    }
    this.attachTaskHandlers(task, ctx);
  }

  private isStale(ctx: TaskContext): boolean {
    return ctx.generation !== this.activeGeneration;
  }

  /** Shared begin/progress/done/error wiring for fresh and reattached tasks. */
  private attachTaskHandlers(task: DownloadTask, ctx: TaskContext): void {
    const { model } = ctx;
    task
      .begin(({ expectedBytes }: { expectedBytes: number }) => {
        if (this.isStale(ctx)) return;
        this.updateState({
          totalBytes: expectedBytes,
          status: 'downloading',
        });
      })
      .progress(({ bytesDownloaded, bytesTotal }: { bytesDownloaded: number; bytesTotal: number }) => {
        if (this.isStale(ctx)) return;
        const now = Date.now();
        if (now - this.lastProgressUpdate < this.PROGRESS_THROTTLE) return;
        this.lastProgressUpdate = now;

        const progress = bytesTotal > 0 ? (bytesDownloaded / bytesTotal) * 100 : 0;
        this.updateState({
          progress,
          bytesDownloaded,
          totalBytes: bytesTotal,
        });
        ctx.onProgress?.(progress);
      })
      .done(({ bytesDownloaded, bytesTotal }: { bytesDownloaded: number; bytesTotal: number }) => {
        // Defer file I/O off the native callback thread to prevent ANR
        // ("RNBackgroundDownloaderModuleImpl.onSuccessfulDownload — Input
        // dispatching timed out"). The native callback runs on the main
        // thread; moveAsync + state updates must not block it.
        setTimeout(() => {
          void this.completeTask(ctx, bytesDownloaded, bytesTotal);
        }, 0);
      })
      .error(({ error, errorCode }: { error: string; errorCode: number }) => {
        if (this.isStale(ctx)) return;
        console.error('Download error:', error, errorCode);
        const failureStage = getDownloadFailureStage(error, errorCode);
        const recoverable = isRecoverableDownloadError(error, errorCode);
        const autoRetry = Boolean(ctx.scheduleRetry) && recoverable && ctx.retryNumber < this.MAX_AUTO_RETRIES;
        this.updateState({
          status: 'failed',
          error: getUserDownloadError(error),
          retryNumber: ctx.retryNumber,
          failureStage,
          canRetry: ctx.reattached ? true : autoRetry,
        });
        void analyticsService.trackModelDownloadFailed({
          ...getDownloadAnalyticsParams(model),
          error: error || (ctx.reattached ? 'reattached_download_failed' : 'download_failed'),
          error_code: errorCode,
          failure_stage: failureStage,
          bytes_downloaded: this.currentState.bytesDownloaded,
          bytes_total: this.currentState.totalBytes,
          download_duration_ms: Date.now() - ctx.startedAt,
          retry_number: ctx.retryNumber,
          recoverable,
          auto_retry: autoRetry,
          ...(ctx.reattached ? { reattached: true } : {}),
        });
        this.currentTask = null;
        if (autoRetry) {
          ctx.scheduleRetry!();
          return;
        }
        this.releaseTemp();
        void deleteAsync(ctx.tempPath, { idempotent: true }).catch(() => {});
        this.settlePending(ctx, false);
      });
  }

  private async completeTask(ctx: TaskContext, bytesDownloaded: number, bytesTotal: number): Promise<void> {
    if (this.isStale(ctx)) return;
    const { model } = ctx;
    try {
      await this.finalizeDownloadedFile(model, ctx.tempPath, ctx.finalPath, bytesTotal);
      if (this.isStale(ctx)) return;
      this.updateState({
        status: 'completed',
        progress: 100,
        failureStage: null,
        canRetry: false,
      });
      void analyticsService.trackModelDownloadCompleted({
        ...getDownloadAnalyticsParams(model),
        bytes_downloaded: bytesDownloaded,
        bytes_total: bytesTotal,
        ...(ctx.reattached
          ? { reattached: true }
          : { download_duration_ms: Date.now() - ctx.startedAt, retry_number: ctx.retryNumber }),
      });
      this.currentTask = null;
      this.releaseTemp();
      // On iOS completeHandler fires the handleEventsForBackgroundURLSession
      // completion callback — signal the OS before resolving so consumers
      // never run ahead of the session being finalized.
      if (completeHandler) {
        completeHandler(model.id);
      }
      this.settlePending(ctx, true);
    } catch (error: any) {
      if (this.isStale(ctx)) return;
      console.error('Failed to finalize download:', error);
      this.updateState({
        status: 'failed',
        error: error.message || 'Failed to finalize download',
        retryNumber: ctx.retryNumber,
        failureStage: 'finalize',
        canRetry: false,
      });
      void analyticsService.trackModelDownloadFailed({
        ...getDownloadAnalyticsParams(model),
        error: error.message || (ctx.reattached ? 'reattached_finalize_failed' : 'failed_to_finalize_download'),
        failure_stage: 'finalize',
        download_duration_ms: Date.now() - ctx.startedAt,
        retry_number: ctx.retryNumber,
        recoverable: false,
        ...(ctx.reattached ? { reattached: true } : {}),
      });
      this.currentTask = null;
      this.releaseTemp();
      if (completeHandler) {
        completeHandler(model.id);
      }
      this.settlePending(ctx, false);
    }
  }

  private settlePending(ctx: TaskContext, ok: boolean): void {
    if (this.pendingSettle === ctx.settle) this.pendingSettle = null;
    ctx.settle(ok);
  }

  private releaseTemp(): void {
    this.releaseTempPath?.();
    this.releaseTempPath = null;
  }

  private updateState(updates: Partial<DownloadState>) {
    this.currentState = { ...this.currentState, ...updates };
    this.notifyListeners();
  }

  private notifyListeners() {
    this.listeners.forEach(listener => listener(this.currentState));
  }

  addListener(listener: DownloadListener): () => void {
    this.listeners.add(listener);
    listener(this.currentState);
    return () => this.listeners.delete(listener);
  }

  getState(): DownloadState {
    return this.currentState;
  }

  /**
   * True while a download owns the service: running, paused (its temp file
   * and native task are still live), or waiting on an automatic retry.
   */
  isBusy(): boolean {
    return (
      this.currentState.status === 'downloading' ||
      this.currentState.status === 'paused' ||
      this.retryTimer !== null
    );
  }

  async startDownload(
    model: DownloadModel,
    onProgress?: (progress: number) => void,
    retryNumber: number = 0,
    startedAt: number = Date.now()
  ): Promise<boolean> {
    await this.initialize();

    if (this.isBusy()) {
      console.warn('Download already in progress');
      return false;
    }

    if (!createDownloadTask) {
      console.error('Background downloader not available');
      void analyticsService.trackModelDownloadFailed({
        ...getDownloadAnalyticsParams(model),
        error: 'background_downloader_unavailable',
        failure_stage: 'native_downloader',
        retry_number: retryNumber,
      });
      this.updateState({
        status: 'failed',
        error: 'Background downloader not available',
        retryNumber,
        failureStage: 'native_downloader',
        canRetry: false,
      });
      return false;
    }

    const generation = ++this.activeGeneration;
    const modelDir = MODELS_DIR;
    const tempPath = getModelTempPath(model);
    const finalPath = getModelPath(model);

    try {
      // Ensure directory exists
      const dirInfo = await getInfoAsync(modelDir);
      if (!dirInfo.exists) {
        await makeDirectoryAsync(modelDir, { intermediates: true });
      }

      // Already downloaded — but only a valid file counts; a truncated body
      // or an HTML error page left at the final path is purged and fetched
      // again instead of being reported as complete forever.
      if (await isModelFileValid(model)) {
        this.updateState({
          status: 'completed',
          progress: 100,
          modelId: model.id,
          modelName: model.name,
          error: null,
          retryNumber,
          failureStage: null,
          canRetry: false,
          reattached: false,
        });
        return true;
      }
      await deleteAsync(finalPath, { idempotent: true }).catch(() => {});

      if (model.sizeBytes > 0) {
        const freeBytes = await getFreeDiskStorageAsync().catch(() => null);
        const requiredBytes = model.sizeBytes + 512 * 1024 * 1024;

        if (freeBytes !== null && freeBytes < requiredBytes) {
          const error = `Not enough storage. Free at least ${formatStorage(requiredBytes - freeBytes)} and try again.`;
          this.updateState({
            status: 'failed',
            progress: 0,
            modelId: model.id,
            modelName: model.name,
            error,
            bytesDownloaded: 0,
            totalBytes: model.sizeBytes,
            retryNumber,
            failureStage: 'preflight_storage',
            canRetry: false,
            reattached: false,
          });
          void analyticsService.trackModelDownloadFailed({
            ...getDownloadAnalyticsParams(model),
            error: 'insufficient_storage',
            free_bytes: freeBytes,
            required_bytes: requiredBytes,
            free_storage_mb: bytesToMb(freeBytes),
            required_storage_mb: bytesToMb(requiredBytes),
            failure_stage: 'preflight_storage',
            retry_number: retryNumber,
            recoverable: false,
          });
          return false;
        }
      }

      // A cancel during the async preflight supersedes this start.
      if (generation !== this.activeGeneration) return false;

      // Clean up any existing temp file
      await deleteAsync(tempPath, { idempotent: true }).catch(() => {});

      this.updateState({
        status: 'downloading',
        progress: 0,
        modelId: model.id,
        modelName: model.name,
        error: null,
        bytesDownloaded: 0,
        totalBytes: model.sizeBytes,
        retryNumber,
        failureStage: null,
        canRetry: true,
        reattached: false,
      });
      void analyticsService.trackModelDownloadStarted({
        ...getDownloadAnalyticsParams(model),
        retry_number: retryNumber,
      });

      // Resolves when the download completes, fails terminally, or is cancelled
      return await new Promise<boolean>((resolve) => {
        let settled = false;
        const settle = (ok: boolean) => {
          if (settled) return;
          settled = true;
          resolve(ok);
        };
        this.pendingSettle = settle;

        const ctx: TaskContext = {
          model,
          tempPath,
          finalPath,
          generation,
          retryNumber,
          startedAt,
          reattached: false,
          onProgress,
          settle,
          scheduleRetry: () => {
            this.retryTimer = setTimeout(() => {
              this.retryTimer = null;
              // Cancelled (or superseded) while waiting: stay dead.
              if (this.isStale(ctx)) return;
              this.pendingSettle = null;
              void this.startDownload(model, onProgress, retryNumber + 1, startedAt).then(settle);
              // The retry's own promise is the one cancel must settle; it
              // chains into ours above.
            }, 800);
          },
        };

        // Create background download task using v4 API
        const task = createDownloadTask!({
          id: model.id,
          url: model.modelUrl,
          destination: tempPath,
        });
        this.currentTask = task;
        this.releaseTempPath?.();
        this.releaseTempPath = claimTempPath(tempPath);
        this.attachTaskHandlers(task, ctx);

        // Start the download (v4 requires explicit start)
        task.start();
      });
    } catch (error: any) {
      console.error('Failed to start download:', error);
      this.currentTask = null;
      this.releaseTemp();
      this.updateState({
        status: 'failed',
        error: error.message || 'Failed to start download',
        retryNumber,
        failureStage: 'start',
        canRetry: false,
      });
      void analyticsService.trackModelDownloadFailed({
        ...getDownloadAnalyticsParams(model),
        error: error.message || 'failed_to_start_download',
        failure_stage: 'start',
        retry_number: retryNumber,
        recoverable: false,
      });
      return false;
    }
  }

  async cancelDownload(): Promise<void> {
    // Invalidate the running task, its pending events and any retry timer.
    this.activeGeneration++;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }

    const task = this.currentTask;
    this.currentTask = null;
    if (task) {
      try {
        await task.stop();
      } catch (error) {
        console.error('Failed to stop download:', error);
      }
    }

    // Unblock whoever awaits startDownload.
    const settle = this.pendingSettle;
    this.pendingSettle = null;
    settle?.(false);

    // Clean up temp file
    if (this.currentState.modelId) {
      try {
        const model = await resolveDownloadModel(this.currentState.modelId);
        if (model) {
          await deleteAsync(getModelTempPath(model), { idempotent: true });
        }
      } catch {}
    }
    this.releaseTemp();

    this.updateState({
      status: 'idle',
      progress: 0,
      modelId: null,
      modelName: null,
      error: null,
      bytesDownloaded: 0,
      totalBytes: 0,
      retryNumber: 0,
      failureStage: null,
      canRetry: false,
      reattached: false,
    });
  }

  async pauseDownload(): Promise<void> {
    if (this.currentTask && this.currentState.status === 'downloading') {
      try {
        await this.currentTask.pause();
        this.updateState({ status: 'paused' });
      } catch (error) {
        console.error('Failed to pause download:', error);
      }
    }
  }

  async resumeDownload(): Promise<boolean> {
    if (this.currentTask && this.currentState.status === 'paused') {
      try {
        await this.currentTask.resume();
        this.updateState({ status: 'downloading' });
        return true;
      } catch (error) {
        console.error('Failed to resume download:', error);
        this.updateState({
          status: 'failed',
          error: 'Failed to resume download',
          failureStage: 'resume',
          canRetry: true,
        });
        return false;
      }
    }
    return false;
  }
}

export const downloadService = DownloadService.getInstance();
