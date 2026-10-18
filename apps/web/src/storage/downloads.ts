import { LOCAL_MODELS, getLocalModel, type LocalModel } from '../catalog';
import type { DownloadEvent, DownloadRequest } from './download.worker';
import { localEngine } from '../engine/localEngine';
import { chooseFolder, forgetFolder, getUsableFolder, reconnectFolder } from './folder';
import { cleanUpBrowserCopy, deleteModel, getModelDiskState, moveModelToFolder, type ModelLocation } from './modelStore';
import { requestPersistence } from './persistence';

/**
 * Download manager (main thread). One worker per active download; a Web
 * Lock per model makes exactly one tab do the downloading while every tab
 * sees its progress over a BroadcastChannel. Downloads the user started are
 * remembered and resume automatically on the next visit.
 */

export type DownloadStatus =
  | 'idle' // nothing on disk
  | 'partial' // some bytes on disk, not running
  | 'downloading'
  | 'waiting' // offline / server trouble, retrying
  | 'verifying'
  | 'moving' // copying into the models folder
  | 'installed'
  | 'error';

export interface DownloadState {
  status: DownloadStatus;
  loaded: number;
  total: number;
  error?: string;
  location?: ModelLocation | null;
}

type Listener = (states: Record<string, DownloadState>) => void;

const PENDING_KEY = 'quo.pendingDownloads';
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('quo-downloads') : null;

const states: Record<string, DownloadState> = {};
const listeners = new Set<Listener>();
const workers = new Map<string, Worker>();
// Settles when a model's worker has exited and released its file handles.
const finished = new Map<string, Promise<void>>();

function emit() {
  const snapshot = { ...states };
  listeners.forEach(listener => listener(snapshot));
}

function setState(modelId: string, next: DownloadState, broadcast = true) {
  states[modelId] = next;
  emit();
  if (broadcast) channel?.postMessage({ modelId, state: next });
}

channel?.addEventListener('message', (event: MessageEvent<{ modelId: string; state: DownloadState }>) => {
  // Another tab is downloading: mirror its progress (never our own worker's).
  if (!workers.has(event.data.modelId)) setState(event.data.modelId, event.data.state, false);
});

function pending(): string[] {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function setPending(modelId: string, active: boolean) {
  const ids = new Set(pending());
  if (active) ids.add(modelId);
  else ids.delete(modelId);
  localStorage.setItem(PENDING_KEY, JSON.stringify([...ids]));
}

export function subscribeDownloads(listener: Listener): () => void {
  listeners.add(listener);
  listener({ ...states });
  return () => listeners.delete(listener);
}

/** Reads what's on disk, then resumes downloads that were interrupted. */
export async function initDownloads(): Promise<void> {
  // Nothing is loaded yet, so browser copies superseded by a folder copy
  // (kept last time because the engine was using them) can go now.
  if (await getUsableFolder()) await Promise.all(LOCAL_MODELS.map(cleanUpBrowserCopy));
  await refreshAll();
  for (const modelId of pending()) {
    const model = getLocalModel(modelId);
    if (model && states[modelId]?.status !== 'installed') void startDownload(model);
    else setPending(modelId, false);
  }
}

async function refreshFromDisk(model: LocalModel): Promise<void> {
  if (workers.has(model.id)) return;
  const disk = await getModelDiskState(model);
  setState(model.id, {
    status: disk.installed ? 'installed' : disk.downloadedBytes > 0 ? 'partial' : 'idle',
    loaded: disk.downloadedBytes,
    total: disk.totalBytes,
    location: disk.location,
  }, false);
}

export async function refreshAll(): Promise<void> {
  await Promise.all(LOCAL_MODELS.map(refreshFromDisk));
}

/** Moves a browser-stored model into the models folder, if one is connected. */
async function moveIfFolder(model: LocalModel): Promise<void> {
  if (!(await getUsableFolder())) return;
  const disk = await getModelDiskState(model);
  if (!disk.installed || disk.location !== 'browser') return;
  setState(model.id, { ...states[model.id], status: 'moving' });
  try {
    await moveModelToFolder(model, localEngine.modelId === model.id);
  } catch {
    // The browser copy is untouched; the model stays usable from there.
  }
}

/** From a click: pick the models folder, then move installed models into it. */
export async function useModelsFolder(): Promise<boolean> {
  if (!(await chooseFolder())) return false;
  await refreshAll(); // a re-picked folder may already hold models
  for (const model of LOCAL_MODELS) await moveIfFolder(model);
  await refreshAll();
  return true;
}

/** From a click: re-grant access to the saved folder. */
export async function reconnectModelsFolder(): Promise<boolean> {
  const granted = await reconnectFolder();
  if (granted) {
    await Promise.all(LOCAL_MODELS.map(cleanUpBrowserCopy));
    await refreshAll();
  }
  return granted;
}

/** Stops using the folder (its files stay). Models in it need re-downloading or reconnecting. */
export async function stopUsingModelsFolder(): Promise<void> {
  await forgetFolder();
  await refreshAll();
}

export async function startDownload(model: LocalModel): Promise<void> {
  if (workers.has(model.id)) return;
  setPending(model.id, true);
  void requestPersistence();

  const run = async (lock: Lock | null) => {
    if (!lock) return; // another tab holds it; we mirror its broadcasts
    const worker = new Worker(new URL('./download.worker.ts', import.meta.url), { type: 'module' });
    workers.set(model.id, worker);
    const current = states[model.id];
    setState(model.id, { status: 'downloading', loaded: current?.loaded ?? 0, total: current?.total ?? 0 });

    await new Promise<void>(resolve => {
      worker.onmessage = (event: MessageEvent<DownloadEvent>) => {
        const message = event.data;
        const prev = states[model.id];
        switch (message.type) {
          case 'progress':
            setState(model.id, { status: 'downloading', loaded: message.loaded, total: message.total });
            break;
          case 'waiting':
            setState(model.id, { ...prev, status: 'waiting' });
            break;
          case 'verifying':
            setState(model.id, { ...prev, status: 'verifying' });
            break;
          case 'done':
            setPending(model.id, false);
            setState(model.id, { ...prev, status: 'installed', loaded: prev.total, location: 'browser' });
            resolve();
            break;
          case 'error':
            if (message.code !== 'busy') setPending(model.id, false);
            setState(model.id, {
              ...prev,
              status: message.code === 'cancelled' ? 'partial' : 'error',
              error: message.code === 'cancelled' ? undefined : message.code,
            });
            resolve();
            break;
        }
      };
      worker.onerror = () => {
        setState(model.id, { ...states[model.id], status: 'error', error: 'worker_failed' });
        resolve();
      };
      worker.postMessage({ type: 'start', modelId: model.id, files: model.files } satisfies DownloadRequest);
    });

    worker.terminate();
    workers.delete(model.id);
    if (states[model.id]?.status === 'installed') {
      await moveIfFolder(model);
      await refreshFromDisk(model);
    }
    if (states[model.id]?.status === 'partial') await refreshFromDisk(model);
  };

  const done = navigator.locks
    ? navigator.locks.request(`quo-download:${model.id}`, { ifAvailable: true }, run)
    : run({ name: model.id, mode: 'exclusive' } as Lock);
  finished.set(model.id, done.then(() => {}, () => {}));
  await done;
}

export function cancelDownload(modelId: string): void {
  setPending(modelId, false);
  workers.get(modelId)?.postMessage({ type: 'cancel' } satisfies DownloadRequest);
}

export async function removeModel(model: LocalModel): Promise<void> {
  cancelDownload(model.id);
  await finished.get(model.id); // the worker must release its file handles first
  await deleteModel(model.id);
  await refreshFromDisk(model);
}
