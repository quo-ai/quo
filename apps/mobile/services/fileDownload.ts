import {
  documentDirectory,
  getInfoAsync,
  makeDirectoryAsync,
  deleteAsync,
  moveAsync,
  readDirectoryAsync,
  createDownloadResumable,
} from 'expo-file-system/legacy';

// Shared plumbing for the resumable-download paths (mmproj projectors in
// llm.ts, the recall embedding model). The big chat-model downloads use
// downloadService's background downloader instead and only share the
// directory/validation helpers.

export const MODELS_DIR = `${documentDirectory}models/`;

interface DownloadProgressData {
  totalBytesWritten: number;
  totalBytesExpectedToWrite: number;
}

export async function ensureModelsDir(): Promise<void> {
  const dirInfo = await getInfoAsync(MODELS_DIR);
  if (!dirInfo.exists) {
    await makeDirectoryAsync(MODELS_DIR, { intermediates: true });
  }
}

export async function fileHasValidSize(path: string, minValidBytes: number): Promise<boolean> {
  try {
    const info = await getInfoAsync(path);
    return info.exists && 'size' in info && info.size >= minValidBytes;
  } catch {
    return false;
  }
}

// Temp files (`*.tmp` / `*.part` under MODELS_DIR) that some in-flight
// operation is writing right now; the startup sweep never touches these.
const activeTempPaths = new Set<string>();

/** Mark a temp file as in use. Returns the release function. */
export function claimTempPath(path: string): () => void {
  activeTempPaths.add(path);
  return () => {
    activeTempPaths.delete(path);
  };
}

/**
 * Delete leftover `*.tmp` / `*.part` files in MODELS_DIR (multi-GB partial
 * downloads from a terminal failure, a killed app, an interrupted copy)
 * that no in-flight operation owns. `keep` adds paths owned by callers that
 * do not use claimTempPath (e.g. a reattached background download task).
 */
export async function sweepStaleTempFiles(keep: string[] = []): Promise<number> {
  const keepSet = new Set(keep);
  let removed = 0;
  try {
    const dirInfo = await getInfoAsync(MODELS_DIR);
    if (!dirInfo.exists) return 0;
    const names = await readDirectoryAsync(MODELS_DIR);
    for (const name of names) {
      if (!name.endsWith('.tmp') && !name.endsWith('.part')) continue;
      const path = `${MODELS_DIR}${name}`;
      if (activeTempPaths.has(path) || keepSet.has(path)) continue;
      await deleteAsync(path, { idempotent: true }).catch(() => {});
      removed++;
    }
  } catch {
    // Best-effort cleanup
  }
  return removed;
}

// In-flight downloads keyed by destination: a second caller for the same
// file (e.g. Settings and the chat download flow both fetching an mmproj)
// joins the first instead of deleting the file it is writing.
const inFlightDownloads = new Map<string, Promise<boolean>>();

/** Temp name a resumable download writes to before it is validated. */
export function getPartialDownloadPath(destPath: string): string {
  return `${destPath}.part`;
}

/**
 * Download url -> destPath with progress and size validation. The body is
 * written to `<destPath>.part` and only renamed into place once it passes
 * the size check, so the final path never holds a partial file. A
 * pre-existing valid file short-circuits to success; a pre-existing invalid
 * file and any undersized result are purged so a retry starts clean.
 * Concurrent calls for the same destination share one download. Returns
 * true only when the file exists at >= minValidBytes. Throws on transport
 * errors.
 */
export function downloadWithValidation(options: {
  url: string;
  destPath: string;
  expectedBytes: number;
  minValidBytes: number;
  onProgress?: (progress: number) => void;
}): Promise<boolean> {
  const existing = inFlightDownloads.get(options.destPath);
  if (existing) return existing;

  const releaseTemp = claimTempPath(getPartialDownloadPath(options.destPath));
  const promise = runDownloadWithValidation(options).finally(() => {
    inFlightDownloads.delete(options.destPath);
    releaseTemp();
  });
  inFlightDownloads.set(options.destPath, promise);
  return promise;
}

async function runDownloadWithValidation(options: {
  url: string;
  destPath: string;
  expectedBytes: number;
  minValidBytes: number;
  onProgress?: (progress: number) => void;
}): Promise<boolean> {
  const { url, destPath, expectedBytes, minValidBytes, onProgress } = options;
  const partPath = getPartialDownloadPath(destPath);

  await ensureModelsDir();

  const existing = await getInfoAsync(destPath);
  if (existing.exists) {
    if ('size' in existing && existing.size >= minValidBytes) {
      onProgress?.(100);
      return true;
    }
    // Clear any truncated leftover (pre-.part builds wrote in place).
    await deleteAsync(destPath, { idempotent: true }).catch(() => {});
  }
  await deleteAsync(partPath, { idempotent: true }).catch(() => {});

  const download = createDownloadResumable(
    url,
    partPath,
    // Platform-neutral UA — same header on Android and iOS.
    { headers: { 'User-Agent': 'Mozilla/5.0 ExpoApp' } },
    (progress: DownloadProgressData) => {
      const total = progress.totalBytesExpectedToWrite > 0
        ? progress.totalBytesExpectedToWrite
        : expectedBytes;
      onProgress?.(Math.min(99, (progress.totalBytesWritten / total) * 100));
    },
  );

  try {
    const result = await download.downloadAsync();
    if (result?.uri && (await fileHasValidSize(partPath, minValidBytes))) {
      await moveAsync({ from: partPath, to: destPath });
      onProgress?.(100);
      return true;
    }
    return false;
  } finally {
    // No-op after a successful move; clears a rejected or aborted body.
    await deleteAsync(partPath, { idempotent: true }).catch(() => {});
  }
}
