import { useState, useEffect, useCallback, useRef } from 'react';
import { useFocusEffect } from 'expo-router';
import { AVAILABLE_MODELS } from '@/constants/models';
import { customModelService, CustomModelConfig } from '@/services/customModelService';
import { llmService } from '@/services/llm';
import { downloadService, DownloadState } from '@/services/downloadService';

export type ModelDownloadStatus = 'not_downloaded' | 'downloading' | 'downloaded';

function inFlightModelId(state: DownloadState): string | null {
  return (state.status === 'downloading' || state.status === 'paused') && state.modelId
    ? state.modelId
    : null;
}

/**
 * On-disk/download status for every built-in and custom model, kept in sync
 * with downloadService and re-checked on screen focus. An in-flight download
 * always wins over the disk check (its file is still a .tmp).
 */
export function useModelDownloadStatus() {
  const [statusById, setStatusById] = useState<Record<string, ModelDownloadStatus>>({});
  const [progressById, setProgressById] = useState<Record<string, number>>({});
  const [customModels, setCustomModels] = useState<CustomModelConfig[]>([]);
  const checkSeqRef = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++checkSeqRef.current;
    const customs = await customModelService.getModels();
    const models = [...AVAILABLE_MODELS, ...customs];
    // Stat all model files in parallel rather than one after another.
    const exists = await Promise.all(models.map(m => llmService.checkModelExists(m.id)));
    if (seq !== checkSeqRef.current) return; // a newer check superseded this one

    const status: Record<string, ModelDownloadStatus> = {};
    models.forEach((model, i) => {
      status[model.id] = exists[i] ? 'downloaded' : 'not_downloaded';
    });
    const downloadingId = inFlightModelId(downloadService.getState());
    if (downloadingId) status[downloadingId] = 'downloading';

    setCustomModels(customs);
    setStatusById(status);
  }, []);

  useEffect(() => {
    void refresh();

    // Subscribe to download service for real-time progress updates
    const unsubscribe = downloadService.addListener((state) => {
      const modelId = state.modelId;
      if (!modelId) {
        if (state.status === 'idle') void refresh();
        return;
      }
      if (state.status === 'downloading' || state.status === 'paused') {
        setStatusById(prev => (prev[modelId] === 'downloading' ? prev : { ...prev, [modelId]: 'downloading' }));
        setProgressById(prev => ({ ...prev, [modelId]: state.progress }));
      } else if (state.status === 'completed') {
        setStatusById(prev => ({ ...prev, [modelId]: 'downloaded' }));
        setProgressById(prev => ({ ...prev, [modelId]: 100 }));
      } else {
        // failed / idle: re-check actual status on disk
        void refresh();
      }
    });

    return () => {
      unsubscribe();
    };
  }, [refresh]);

  // Re-check model status when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  const setStatus = useCallback((modelId: string, status: ModelDownloadStatus | null) => {
    setStatusById(prev => {
      const next = { ...prev };
      if (status === null) delete next[modelId];
      else next[modelId] = status;
      return next;
    });
  }, []);

  const setProgress = useCallback((modelId: string, progress: number) => {
    setProgressById(prev => ({ ...prev, [modelId]: progress }));
  }, []);

  return {
    statusById,
    progressById,
    customModels,
    refresh,
    setStatus,
    setProgress,
  };
}
