/// <reference lib="webworker" />
/**
 * Resumable model downloader (dedicated worker: OPFS sync access handles are
 * worker-only and keep writes off the UI thread).
 *
 * - Resumes from the bytes already on disk with an HTTP Range request, so a
 *   closed tab, reload, crash or dropped connection never restarts from zero.
 * - Network failures retry forever with capped backoff until cancelled;
 *   the UI shows "waiting for connection" meanwhile.
 * - A server that ignores Range (200) restarts that file cleanly; a size the
 *   catalog doesn't expect fails loudly instead of looping.
 * - Done only after every file is its exact size and the first starts with
 *   the GGUF magic (truncated GGUFs pass existence checks but crash the
 *   engine — the same rule as the mobile app).
 */
import type { ModelFile } from '../catalog';

export type DownloadRequest =
  | { type: 'start'; modelId: string; files: ModelFile[] }
  | { type: 'cancel' };

export type DownloadEvent =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'waiting'; attempt: number; retryInMs: number }
  | { type: 'verifying' }
  | { type: 'done' }
  | { type: 'error'; code: string };

const PROGRESS_INTERVAL_MS = 250;
const FLUSH_EVERY_BYTES = 32 * 1024 * 1024;
const MAX_BACKOFF_MS = 30_000;

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let controller: AbortController | null = null;

const post = (event: DownloadEvent) => ctx.postMessage(event);

class FatalDownloadError extends Error {}

ctx.onmessage = (event: MessageEvent<DownloadRequest>) => {
  const request = event.data;
  if (request.type === 'cancel') {
    controller?.abort();
    return;
  }
  if (controller) return; // one download per worker
  controller = new AbortController();
  void run(request.modelId, request.files, controller.signal).finally(() => {
    controller = null;
  });
};

async function run(modelId: string, files: ModelFile[], signal: AbortSignal): Promise<void> {
  const handles: FileSystemSyncAccessHandle[] = [];
  try {
    const root = await navigator.storage.getDirectory();
    const models = await root.getDirectoryHandle('models', { create: true });
    const dir = await models.getDirectoryHandle(modelId, { create: true });

    const total = files.reduce((sum, file) => sum + file.sizeBytes, 0);
    for (const file of files) {
      const handle = await (await dir.getFileHandle(file.name, { create: true })).createSyncAccessHandle();
      handles.push(handle);
      if (handle.getSize() > file.sizeBytes) handle.truncate(0);
    }

    const progress = createProgressReporter(handles, total);
    for (let i = 0; i < files.length; i++) {
      await downloadFile(files[i], handles[i], signal, progress);
    }

    post({ type: 'verifying' });
    files.forEach((file, i) => {
      if (handles[i].getSize() !== file.sizeBytes) throw new FatalDownloadError('size_mismatch');
    });
    const magic = new Uint8Array(4);
    handles[0].read(magic, { at: 0 });
    if (new TextDecoder().decode(magic) !== 'GGUF') {
      handles[0].truncate(0); // corrupt: start over next time
      throw new FatalDownloadError('invalid_model_file');
    }
    post({ type: 'done' });
  } catch (error) {
    if (signal.aborted) post({ type: 'error', code: 'cancelled' });
    else if (error instanceof FatalDownloadError) post({ type: 'error', code: error.message });
    else if ((error as DOMException)?.name === 'QuotaExceededError') post({ type: 'error', code: 'storage_full' });
    else if ((error as DOMException)?.name === 'NoModificationAllowedError') post({ type: 'error', code: 'busy' });
    else post({ type: 'error', code: 'unknown' });
  } finally {
    for (const handle of handles) {
      try {
        handle.flush();
        handle.close();
      } catch {
        // Already closed.
      }
    }
  }
}

function createProgressReporter(handles: FileSystemSyncAccessHandle[], total: number) {
  let last = 0;
  return (force = false) => {
    const now = Date.now();
    if (!force && now - last < PROGRESS_INTERVAL_MS) return;
    last = now;
    const loaded = handles.reduce((sum, handle) => sum + handle.getSize(), 0);
    post({ type: 'progress', loaded, total });
  };
}

async function downloadFile(
  file: ModelFile,
  handle: FileSystemSyncAccessHandle,
  signal: AbortSignal,
  progress: (force?: boolean) => void,
): Promise<void> {
  let attempt = 0;
  while (handle.getSize() < file.sizeBytes) {
    if (signal.aborted) throw new DOMException('aborted', 'AbortError');
    try {
      await fetchRemainder(file, handle, signal, progress);
      attempt = 0;
    } catch (error) {
      if (signal.aborted || error instanceof FatalDownloadError) throw error;
      if ((error as DOMException)?.name === 'QuotaExceededError') throw error;
      // Network trouble: wait and resume from what's on disk.
      attempt++;
      const retryInMs = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(attempt - 1, 5));
      post({ type: 'waiting', attempt, retryInMs });
      await sleep(retryInMs, signal);
    }
  }
  progress(true);
}

async function fetchRemainder(
  file: ModelFile,
  handle: FileSystemSyncAccessHandle,
  signal: AbortSignal,
  progress: (force?: boolean) => void,
): Promise<void> {
  let offset = handle.getSize();
  const response = await fetch(file.url, {
    headers: offset > 0 ? { Range: `bytes=${offset}-` } : undefined,
    cache: 'no-store',
    signal,
  });

  if (response.status === 200) {
    // Range ignored (or fresh start): the body is the whole file.
    const length = Number(response.headers.get('content-length'));
    if (length && length !== file.sizeBytes) throw new FatalDownloadError('size_mismatch');
    handle.truncate(0);
    offset = 0;
  } else if (response.status === 206) {
    const total = Number(response.headers.get('content-range')?.split('/')[1]);
    if (total && total !== file.sizeBytes) throw new FatalDownloadError('size_mismatch');
  } else if (response.status === 416) {
    // Nothing left to fetch per the server, yet we're short: start clean.
    handle.truncate(0);
    return;
  } else if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
    throw new FatalDownloadError(`http_${response.status}`);
  } else {
    throw new Error(`http_${response.status}`); // 5xx/408/429: retry
  }

  if (!response.body) throw new Error('no_body');
  const reader = response.body.getReader();
  let sinceFlush = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.byteLength > file.sizeBytes) throw new FatalDownloadError('size_mismatch');
      handle.write(value, { at: offset });
      offset += value.byteLength;
      sinceFlush += value.byteLength;
      if (sinceFlush >= FLUSH_EVERY_BYTES) {
        handle.flush();
        sinceFlush = 0;
      }
      progress();
    }
  } finally {
    handle.flush();
    reader.releaseLock();
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('aborted', 'AbortError'));
    }, { once: true });
  });
}
