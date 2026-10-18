import { allLocalModels, type LocalModel } from '../catalog';
import { nativeBridge, unwrap, type ModelEvent } from '../native';
import type { DownloadState } from './downloads';

/**
 * Model downloads in the desktop app. The main process does the work (resumable
 * HTTP into the models folder, verified before it counts as installed) and
 * reports progress as events; this maps them onto the same DownloadState the
 * browser's downloader produces, so the UI is identical.
 */

export interface DownloadStore {
  get(modelId: string): DownloadState | undefined;
  set(modelId: string, state: DownloadState): void;
  /** Remembers (or forgets) that the user started this download, so it resumes after a restart. */
  setPending(modelId: string, active: boolean): void;
}

const filesOf = (model: LocalModel) => model.files.map(({ url, name, sizeBytes }) => ({ url, name, sizeBytes }));

let listening = false;

export function listenForDownloads(store: DownloadStore): void {
  const bridge = nativeBridge();
  if (!bridge || listening) return;
  listening = true;
  bridge.models.onEvent(event => void onEvent(event, store));
}

async function onEvent(event: ModelEvent, store: DownloadStore): Promise<void> {
  const prev = store.get(event.modelId) ?? { status: 'idle' as const, loaded: 0, total: 0 };
  const total = event.total || prev.total;
  switch (event.type) {
    case 'progress':
      store.set(event.modelId, { status: 'downloading', loaded: event.loaded ?? prev.loaded, total });
      break;
    case 'waiting':
      store.set(event.modelId, { ...prev, status: 'waiting', total });
      break;
    case 'verifying':
      store.set(event.modelId, { ...prev, status: 'verifying', total });
      break;
    case 'done':
      store.setPending(event.modelId, false);
      store.set(event.modelId, { status: 'installed', loaded: total, total, location: null });
      break;
    case 'error': {
      const cancelled = event.code === 'cancelled';
      if (!cancelled) store.setPending(event.modelId, false);
      store.set(event.modelId, {
        status: cancelled ? 'partial' : 'error',
        loaded: event.loaded ?? prev.loaded,
        total,
        error: cancelled ? undefined : event.code,
      });
      break;
    }
  }
}

/** Reads what's on disk for every model (and marks added models as installed). */
export async function refreshNative(store: DownloadStore): Promise<void> {
  const bridge = nativeBridge();
  if (!bridge) return;
  await Promise.all(allLocalModels().map(async model => {
    if (model.custom) {
      const size = model.files[0].sizeBytes;
      return store.set(model.id, { status: 'installed', loaded: size, total: size, location: null });
    }
    const current = store.get(model.id)?.status;
    if (current === 'downloading' || current === 'waiting' || current === 'verifying') return;
    const disk = unwrap(await bridge.models.state(model.id, filesOf(model)));
    store.set(model.id, {
      status: disk.installed ? 'installed' : disk.downloadedBytes > 0 ? 'partial' : 'idle',
      loaded: disk.downloadedBytes,
      total: disk.totalBytes,
      location: null,
    });
  }));
}

export async function startNative(model: LocalModel, store: DownloadStore): Promise<void> {
  const bridge = nativeBridge();
  if (!bridge || model.custom) return;
  store.setPending(model.id, true);
  const current = store.get(model.id);
  store.set(model.id, { status: 'downloading', loaded: current?.loaded ?? 0, total: current?.total ?? 0 });
  unwrap(await bridge.models.download(model.id, filesOf(model)));
}

export function cancelNative(modelId: string): void {
  void nativeBridge()?.models.cancel(modelId);
}

export async function removeNative(model: LocalModel, store: DownloadStore): Promise<void> {
  const bridge = nativeBridge();
  if (!bridge) return;
  store.setPending(model.id, false);
  unwrap(await bridge.models.remove(model.id));
  store.set(model.id, { status: 'idle', loaded: 0, total: model.files.reduce((sum, file) => sum + file.sizeBytes, 0), location: null });
}
