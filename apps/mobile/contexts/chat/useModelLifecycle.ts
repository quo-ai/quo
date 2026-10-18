import { useState, useEffect, useRef, useCallback, Dispatch, SetStateAction } from 'react';
import { Alert } from 'react-native';
import { AppSettings } from '@/types/chat';
import {
  saveSettings,
  getPendingModelLoad,
  setPendingModelLoad,
  getPendingModelSelection,
  setPendingModelSelection,
} from '@/services/storage';
import { llmService, ModelStatus } from '@/services/llm';
import { downloadService } from '@/services/downloadService';
import { DEFAULT_MODEL_ID, getDefaultModel, AVAILABLE_MODELS, getAllModels } from '@/constants/models';
import { customModelService } from '@/services/customModelService';
import { isBundledStarterAvailable, deliverStarterPack, isStarterPackOnItsWay, removeRedundantStarterPack } from '@/services/bundledModel';
import { FREE_TIER_LIMITS } from '@/constants/premium';
import { analyticsService } from '@/services/analyticsService';
import { applyModelToSettings, getCurrentModelAnalyticsParams, getFreeStarterModel, isFreeTierModel } from './helpers';

// Point llmService at a model id (custom models need the async lookup).
async function setServiceModel(modelId: string): Promise<boolean> {
  if (customModelService.isCustomModel(modelId)) {
    return llmService.setCurrentModelAsync(modelId);
  }
  llmService.setCurrentModel(modelId);
  return llmService.getCurrentModelId() === modelId;
}

async function waitForLoadIdle(timeoutMs = 130000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (llmService.getIsLoading() && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

// Model lifecycle: bootstrap with fallback selection on app start, manual
// load with timeout, and download orchestration (including the download
// service state -> UI sync).
//
// Persistence rule: settings.modelId only ever names a model that has
// loaded successfully. Every load is bracketed by a pending-load marker so a
// model that kills the process mid-load (iOS jetsam, Android LMK) is not
// retried at the next launch — bootstrap falls back to the starter instead
// of crash-looping.
export function useModelLifecycle({
  isPremium,
  setSettings,
}: {
  isPremium: boolean;
  setSettings: Dispatch<SetStateAction<AppSettings>>;
}) {
  const [modelLoaded, setModelLoaded] = useState(false);
  const [modelLoadProgress, setModelLoadProgress] = useState(0);
  const [modelStatus, setModelStatus] = useState<ModelStatus>('not_downloaded');
  const [modelError, setModelError] = useState<string | null>(null);
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [visionEnabled, setVisionEnabled] = useState(false);
  const [showModelSelection, setShowModelSelection] = useState(false);
  const [downloadingModelId, setDownloadingModelId] = useState<string | null>(null);
  const downloadStateRef = useRef(downloadService.getState());
  const reattachedCompleteRef = useRef<((modelId: string) => Promise<void>) | null>(null);
  // A download that finished while the app was dead can report before
  // startup has loaded settings/premium; hold it until bootstrap is done.
  const bootstrapDoneRef = useRef(false);
  const pendingReattachedRef = useRef<string | null>(null);
  // Synchronous "a load owns the crash marker" flag (llmService.isLoading is
  // only set once loadModel runs, after our awaited marker write).
  const markerOwnedRef = useRef(false);

  // Subscribe to download service state changes for accurate UI updates
  useEffect(() => {
    const unsubscribeDownload = downloadService.addListener((state) => {
      downloadStateRef.current = state;
      // Sync download state to UI based on download service state
      switch (state.status) {
        case 'downloading':
          setModelStatus('downloading');
          setModelLoadProgress(state.progress * 0.5); // Download is 0-50%
          setDownloadingModelId(state.modelId);
          break;
        case 'paused':
          // Keep showing as downloading but progress won't update
          setModelStatus('downloading');
          setDownloadingModelId(state.modelId);
          break;
        case 'completed':
          // Download completed, model loading will update progress further
          // Don't reset downloadingModelId here - let startDownload handle it.
          // A download reattached from a previous session has no waiting
          // startDownload, so run its post-download flow here.
          if (state.reattached && state.modelId) {
            if (bootstrapDoneRef.current) {
              void reattachedCompleteRef.current?.(state.modelId);
            } else {
              pendingReattachedRef.current = state.modelId;
            }
          }
          break;
        case 'failed':
          setModelStatus('error');
          setModelError(state.error || 'Download failed');
          setDownloadingModelId(null);
          break;
        case 'idle':
          // Only reset if we were tracking a download
          setDownloadingModelId(prev => {
            if (prev) {
              setModelStatus('not_downloaded');
            }
            return null;
          });
          break;
      }
    });

    return unsubscribeDownload;
  }, []); // No dependencies - subscribe once on mount

  // Shared model-load sequence used by every path that loads a model:
  // analytics start/success/failure events, loading/ready/error status,
  // progress mapping, vision flag, and a 2-minute timeout guard. Site
  // specific behavior (modal state, extra analytics) goes through
  // onSuccess/onFailure; the failure message is per-site.
  const performLoad = useCallback(async (
    source: string,
    {
      progressBase = 50,
      failureMessage = 'Failed to load model. Please try again.',
      onSuccess,
      onFailure,
    }: {
      /** Progress % at which loading starts; load progress fills base->100. */
      progressBase?: number;
      /** modelError message when loadModel returns false (or non-Error throw). */
      failureMessage?: string;
      onSuccess?: () => void;
      onFailure?: () => void;
    } = {}
  ): Promise<boolean> => {
    setModelLoaded(false); // Reset in case we're switching models
    setModelStatus('loading');
    setModelLoadProgress(progressBase);
    setModelError(null);
    const loadStartedAt = Date.now();
    void analyticsService.trackModelLoadStarted(getCurrentModelAnalyticsParams(source, isPremium));

    // Add timeout to prevent getting stuck on loading
    const LOAD_TIMEOUT = 120000; // 2 minutes
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<boolean>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error('Model loading timed out. Please try again.'));
      }, LOAD_TIMEOUT);
    });

    const loadingModel = llmService.getCurrentModel();
    // Awaited before initLlama: if the process dies inside the load, the
    // marker survives and the next launch skips this model. A call that
    // finds another load in flight is refused by llmService and must not
    // touch the marker that load owns.
    const ownsMarker = !markerOwnedRef.current && !llmService.getIsLoading();
    if (ownsMarker) {
      markerOwnedRef.current = true;
      await setPendingModelLoad(loadingModel.id);
    }

    try {
      const loadPromise = llmService.loadModel((progress) => {
        setModelLoadProgress(progressBase + progress * (100 - progressBase) / 100);
      });
      if (ownsMarker) {
        // Cleared when the native load actually returns (success or not) —
        // not at the UI timeout, since initLlama may still be running.
        const release = () => {
          markerOwnedRef.current = false;
          return setPendingModelLoad(null);
        };
        void loadPromise.then(release, release);
      }
      const success = await Promise.race([loadPromise, timeoutPromise]);

      if (success) {
        setModelLoaded(true);
        setModelStatus('ready');
        setModelLoadProgress(100);
        // Only now does the model become the persisted selection. Keep the
        // user's tuned parameters when the model did not change.
        setSettings(prev => {
          if (prev.modelId === loadingModel.id) return prev;
          const updated = applyModelToSettings(prev, loadingModel);
          void saveSettings(updated);
          return updated;
        });
        void setPendingModelSelection(null);
        // Enable image attachment if model supports vision
        setVisionEnabled(llmService.getCurrentModel().hasVision);
        void analyticsService.setUserProperty('has_downloaded_model', true);
        void analyticsService.trackModelLoaded({
          ...getCurrentModelAnalyticsParams(source, isPremium),
          duration_ms: Date.now() - loadStartedAt,
          gpu: Boolean(llmService.getDeviceInfo()?.gpu),
        });
        onSuccess?.();
        return true;
      }

      setModelLoaded(false);
      setModelStatus('error');
      setModelError(failureMessage);
      setVisionEnabled(false);
      void analyticsService.trackModelLoadFailed({
        ...getCurrentModelAnalyticsParams(source, isPremium),
        duration_ms: Date.now() - loadStartedAt,
        error: 'load_returned_false',
      });
      onFailure?.();
      return false;
    } catch (error) {
      setModelLoaded(false);
      setModelStatus('error');
      setModelError(error instanceof Error ? error.message : failureMessage);
      setVisionEnabled(false);
      void analyticsService.trackModelLoadFailed({
        ...getCurrentModelAnalyticsParams(source, isPremium),
        duration_ms: Date.now() - loadStartedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      onFailure?.();
      return false;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }, [isPremium, setSettings]);

  const finishBootstrap = useCallback(() => {
    bootstrapDoneRef.current = true;
    const pending = pendingReattachedRef.current;
    pendingReattachedRef.current = null;
    if (pending) void reattachedCompleteRef.current?.(pending);
  }, []);

  // startDownload is defined below bootstrapModel; reach it through a ref.
  const startDownloadRef = useRef<(() => Promise<void>) | null>(null);

  // App-start bootstrap: load the selected model if downloaded, otherwise
  // fall back to any model on disk, otherwise show model selection.
  const bootstrapModel = useCallback(async (loadedSettings: AppSettings) => {
    // A load marker left over from the previous launch means the process
    // died while loading that model. Don't autoload it again: fall back to
    // the starter and tell the user.
    const crashedModelId = await getPendingModelLoad();
    if (crashedModelId) {
      await setPendingModelLoad(null);
      void analyticsService.track('model_load_crash_recovered', { model_id: crashedModelId });
      const starter = getFreeStarterModel();
      // Only act if the model that crashed is the one we'd load now; if the
      // user had switched back to another model, leave their choice alone.
      const crashedIsSelected = llmService.getCurrentModelId() === crashedModelId;
      const crashedModel = crashedIsSelected ? llmService.getCurrentModel() : null;
      if (crashedIsSelected && crashedModelId === starter.id) {
        // Nothing smaller to fall back to: don't autoload into another crash.
        const message = `${starter.name} closed the app while loading. Free up memory (close other apps) and tap to retry.`;
        setModelStatus('error');
        setModelError(message);
        finishBootstrap();
        return;
      }
      if (crashedIsSelected) {
        llmService.setCurrentModel(starter.id);
        setSettings(prev => {
          if (prev.modelId !== crashedModelId) return prev;
          const updated = applyModelToSettings(prev, starter);
          void saveSettings(updated);
          return updated;
        });
        const name = crashedModel?.name ?? 'The selected model';
        const message = `${name} closed the app while loading — it likely needs more memory than this device has. Switched to ${starter.name}.`;
        setModelError(message);
        Alert.alert('Model Switched', message);
      }
    }

    // Check if selected model exists
    const selectedModelExists = await llmService.checkModelExists();

    if (selectedModelExists) {
      // Selected model is downloaded, load it
      await performLoad('app_start', {
        failureMessage: 'Failed to load model. The file may be corrupted.',
      });
    } else {
      // Selected model not downloaded - check if ANY model exists on disk
      let fallbackModel: typeof AVAILABLE_MODELS[0] | null = null;

      // Check all available models including custom (prioritize default first)
      const allModels = await getAllModels();
      const modelsToCheck = [
        getDefaultModel(),
        ...allModels.filter(m => m.id !== DEFAULT_MODEL_ID)
      ];

      for (const model of modelsToCheck.filter(m => isPremium || isFreeTierModel(m.id))) {
        const exists = await llmService.checkModelExists(model.id);
        if (exists) {
          fallbackModel = model;
          break;
        }
      }

      // Note: builds that bundle the starter model never reach the
      // no-model branch — checkModelExists reports the bundled asset as
      // available and loadModel runs it directly (or copies it out).

      if (fallbackModel) {
        // Fall back to available model (use async for custom models)
        if (customModelService.isCustomModel(fallbackModel.id)) {
          await llmService.setCurrentModelAsync(fallbackModel.id);
        } else {
          llmService.setCurrentModel(fallbackModel.id);
        }
        // Settings follow only once the load succeeds (performLoad).
        await performLoad('fallback_on_start');
      } else {
        // No models downloaded - show model selection for first-time users
        setModelStatus('not_downloaded');
        setShowModelSelection(true);
        void analyticsService.setUserProperty('has_downloaded_model', false);
        // Fresh Play install: the starter pack is already on its way, so show
        // its progress right away rather than a "Download" button for a
        // second copy.
        if (llmService.getCurrentModelId() === DEFAULT_MODEL_ID && (await isStarterPackOnItsWay())) {
          startDownloadRef.current?.();
        }
      }
    }
    finishBootstrap();
    // Upgrades from the install-time pack still get the fast-follow pack
    // delivered; drop it when a copied starter already exists.
    void removeRedundantStarterPack();
  }, [performLoad, setSettings, isPremium, finishBootstrap]);

  // Select a downloaded model and load it; settings follow only on success.
  // On failure the service falls back to the previously selected model id so
  // a retry/"Load model" targets what is persisted.
  const selectModel = useCallback(async (modelId: string): Promise<boolean> => {
    const previousModelId = llmService.getCurrentModelId();
    if (!(await setServiceModel(modelId))) return false;
    const ok = await performLoad('settings_switch', {
      progressBase: 0,
      failureMessage: 'Failed to load the model. Please try again.',
    });
    if (!ok && previousModelId !== modelId) {
      await setServiceModel(previousModelId);
    }
    return ok;
  }, [performLoad]);

  // A model file was deleted. If it was the active/selected model, drop the
  // loaded state and switch to the starter (or any other downloaded model
  // the user may use), loading it; with nothing left, show model selection.
  const handleModelDeleted = useCallback(async (modelId: string) => {
    const wasActive = llmService.getCurrentModelId() === modelId || llmService.isModelCurrentlyLoaded(modelId);
    if (!wasActive) return;

    setModelLoaded(false);
    setVisionEnabled(false);
    setModelStatus('not_downloaded');

    const starter = getFreeStarterModel();
    const candidates = [
      starter,
      ...(await getAllModels()).filter(m => m.id !== starter.id),
    ].filter(m => m.id !== modelId && (isPremium || isFreeTierModel(m.id)));

    for (const candidate of candidates) {
      if (await llmService.checkModelExists(candidate.id)) {
        await setServiceModel(candidate.id);
        await performLoad('model_deleted_fallback', { progressBase: 0 });
        return;
      }
    }

    // Nothing usable on disk: point at the starter and send the user to the
    // model picker.
    llmService.setCurrentModel(starter.id);
    setSettings(prev => {
      const updated = applyModelToSettings(prev, starter);
      void saveSettings(updated);
      return updated;
    });
    setShowModelSelection(true);
  }, [isPremium, performLoad, setSettings]);

  // Post-download flow for a download that finished after an app restart
  // (or while no startDownload caller was waiting): load it when it is the
  // selected model or the one the user picked before the restart.
  useEffect(() => {
    reattachedCompleteRef.current = async (modelId: string) => {
      setDownloadingModelId(null);
      const pendingSelection = await getPendingModelSelection();
      const isSelected = llmService.getCurrentModelId() === modelId || pendingSelection === modelId;
      if (!isSelected || llmService.isModelCurrentlyLoaded(modelId)) {
        setModelStatus(prev => (prev === 'downloading' ? 'downloaded' : prev));
        return;
      }
      if (!isPremium && !isFreeTierModel(modelId)) return;
      await waitForLoadIdle();
      if (llmService.isModelCurrentlyLoaded(modelId)) return;
      if (!(await setServiceModel(modelId))) return;
      const model = llmService.getCurrentModel();
      if (model.hasVision && model.mmprojUrl) {
        await llmService.downloadMmproj(undefined, model);
      }
      await performLoad('reattached_download', {
        progressBase: 60,
        failureMessage: 'Model downloaded but failed to load. Please try again.',
        onSuccess: () => setShowModelSelection(false),
      });
    };
  }, [isPremium, performLoad]);

  const loadModel = useCallback(async (): Promise<boolean> => {
    return performLoad('manual_load', {
      failureMessage: 'Failed to load model into memory.',
    });
  }, [performLoad]);

  const startDownload = useCallback(async () => {
    let currentModel = llmService.getCurrentModel();

    if (!isPremium && !isFreeTierModel(currentModel.id)) {
      // Settings follow once the starter has loaded (performLoad).
      currentModel = getFreeStarterModel();
      llmService.setCurrentModel(currentModel.id);
    }

    setModelError(null);
    setShowDownloadModal(false);

    try {
      // Builds that ship the starter model with the app skip the network
      // download entirely — loadModel() below runs it straight from the
      // asset pack (or copies it out as a fallback).
      let usedBundledStarter =
        currentModel.id === DEFAULT_MODEL_ID && (await isBundledStarterAvailable());

      // Android Play installs: the starter arrives as a fast-follow asset
      // pack that Play downloads right after install. Follow (or start) that
      // download instead of fetching a second copy from the network.
      if (!usedBundledStarter && currentModel.id === DEFAULT_MODEL_ID) {
        setModelStatus('downloading');
        setDownloadingModelId(currentModel.id);
        const packResult = await deliverStarterPack(fraction => setModelLoadProgress(fraction * 50));
        void analyticsService.track('starter_pack_delivery', { result: packResult });
        if (packResult === 'completed') {
          usedBundledStarter = true;
        } else if (packResult === 'waiting_for_wifi' || packResult === 'insufficient_storage') {
          setModelStatus('error');
          setModelError(packResult === 'waiting_for_wifi'
            ? `${currentModel.name} will download automatically on Wi-Fi. Tap Try Again to download now over mobile data.`
            : `Not enough storage for ${currentModel.name} (${currentModel.size}). Free up some space and try again.`);
          setShowDownloadModal(true);
          setDownloadingModelId(null);
          return;
        } else {
          // 'unavailable' (sideloaded/dev build) or a failed pack delivery:
          // fall back to the regular download below.
          setModelStatus('not_downloaded');
          setDownloadingModelId(null);
        }
      }

      if (!usedBundledStarter && downloadService.isBusy()) {
        const busyName = downloadService.getState().modelName;
        setModelStatus('error');
        setModelError(`Another download is in progress${busyName ? ` (${busyName})` : ''}. Wait for it to finish or cancel it first.`);
        setShowDownloadModal(true);
        return;
      }

      // Use the download service which handles notifications and state
      const downloadSuccess = usedBundledStarter || await downloadService.startDownload(currentModel);

      if (!downloadSuccess) {
        setShowDownloadModal(true);
        setDownloadingModelId(null);
        return;
      }

      // Vision projector only after the main weights landed — a failed or
      // refused main download must not leave a stray mmproj transfer.
      if (currentModel.hasVision && currentModel.mmprojUrl) {
        const mmprojSuccess = await llmService.downloadMmproj(undefined, currentModel);
        if (!mmprojSuccess) {
          setModelStatus('error');
          setModelError('Model downloaded, but vision support failed to download. Please try again.');
          setShowDownloadModal(true);
          setDownloadingModelId(null);
          void analyticsService.trackModelLoadFailed({
            ...getCurrentModelAnalyticsParams('download_then_load', isPremium),
            error: 'mmproj_download_failed',
          });
          return;
        }
      }

      // Now load the model (loading fills the 60-100% progress range)
      await performLoad('download_then_load', {
        progressBase: 60,
        failureMessage: 'Model downloaded but failed to load. Please try again.',
        onSuccess: () => {
          setShowModelSelection(false);
          setDownloadingModelId(null);
          void analyticsService.setUserProperty('selected_model_id', currentModel.id);
        },
        onFailure: () => {
          setShowDownloadModal(true);
          setDownloadingModelId(null);
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      analyticsService.recordError(error, 'model_download_or_load_exception');

      if (errorMessage.includes('network') || errorMessage.includes('fetch')) {
        setModelError('Network error. Please check your internet connection.');
      } else if (errorMessage.includes('space') || errorMessage.includes('storage')) {
        setModelError('Not enough storage space. Please free up at least 2.5GB.');
      } else {
        setModelError(`Download failed: ${errorMessage}`);
      }
      setModelStatus('error');
      setShowDownloadModal(true);
      setDownloadingModelId(null);
    }
  }, [isPremium, performLoad]);
  useEffect(() => {
    startDownloadRef.current = startDownload;
  }, [startDownload]);


  const startDownloadForModel = useCallback(async (modelId: string) => {
    const targetModelId = !isPremium && !isFreeTierModel(modelId)
      ? FREE_TIER_LIMITS.STARTER_MODEL_ID
      : modelId;

    // Point the service at the model; settings.modelId follows only after
    // it has loaded (performLoad), so a model that crashes on load is never
    // the persisted selection.
    if (!(await setServiceModel(targetModelId))) return;
    const model = llmService.getCurrentModel();
    void analyticsService.setUserProperty('selected_model_id', model.id);

    // Check if already downloaded
    const exists = await llmService.checkModelExists(targetModelId);
    if (exists) {
      // Just load it
      await performLoad('selected_existing_model', {
        failureMessage: 'Failed to load model.',
        onSuccess: () => setShowModelSelection(false),
      });
      return;
    }

    // Remember the pick across a restart mid-download.
    await setPendingModelSelection(model.id);

    // Start download
    await startDownload();
  }, [startDownload, isPremium, performLoad]);

  const cancelDownload = useCallback(async () => {
    void analyticsService.trackModelDownloadCancelled(getCurrentModelAnalyticsParams('user_cancelled', isPremium));
    await downloadService.cancelDownload();
    void setPendingModelSelection(null);
    setModelStatus('not_downloaded');
    setModelLoadProgress(0);
    setShowDownloadModal(false);
    setDownloadingModelId(null);
  }, [isPremium]);

  const dismissDownloadModal = useCallback(() => {
    setShowDownloadModal(false);
  }, []);

  const showDownloadPrompt = useCallback(() => {
    setShowDownloadModal(true);
  }, []);

  return {
    modelLoaded,
    modelLoadProgress,
    modelStatus,
    modelError,
    showDownloadModal,
    visionEnabled,
    showModelSelection,
    downloadingModelId,
    downloadStateRef,
    setModelLoaded,
    setModelStatus,
    setModelError,
    setShowModelSelection,
    bootstrapModel,
    loadModel,
    selectModel,
    handleModelDeleted,
    startDownload,
    startDownloadForModel,
    cancelDownload,
    dismissDownloadModal,
    showDownloadPrompt,
  };
}
