import type { LocalModel } from '../catalog';
import { getUsableFolder } from './folder';

/**
 * Where a model's files live, and whether they're complete.
 *
 * Two locations:
 * - OPFS (models/<modelId>/): always used for downloading. Not cleared by
 *   "clear cached images and files"; with persistent storage granted the
 *   browser won't evict it.
 * - The user's models folder (folder.ts), when connected: ordinary files
 *   that survive clearing site data. Preferred when complete.
 *
 * Validity rule (the mobile app's isModelFileValid, but exact since we know
 * the bytes): every file is exactly its catalog size, and the first file
 * starts with the GGUF magic. A partial file is simply a shorter file, which
 * the downloader resumes.
 */

export type ModelLocation = 'folder' | 'browser';

const MODELS_DIR = 'models';

async function opfsModels(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(MODELS_DIR, { create: true });
}

async function childDir(parent: FileSystemDirectoryHandle, name: string, create = false): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await parent.getDirectoryHandle(name, { create });
  } catch {
    return null;
  }
}

export async function getModelDir(location: ModelLocation, modelId: string, create = false): Promise<FileSystemDirectoryHandle | null> {
  if (location === 'browser') return childDir(await opfsModels(), modelId, create);
  const folder = await getUsableFolder();
  return folder ? childDir(folder, modelId, create) : null;
}

async function getFile(dir: FileSystemDirectoryHandle, name: string): Promise<File | null> {
  try {
    return await (await dir.getFileHandle(name)).getFile();
  } catch {
    return null;
  }
}

async function isComplete(model: LocalModel, dir: FileSystemDirectoryHandle | null): Promise<{ complete: boolean; bytes: number }> {
  if (!dir) return { complete: false, bytes: 0 };
  let bytes = 0;
  let complete = true;
  for (const entry of model.files) {
    const size = (await getFile(dir, entry.name))?.size ?? 0;
    bytes += Math.min(size, entry.sizeBytes);
    if (size !== entry.sizeBytes) complete = false;
  }
  if (complete) {
    const first = await getFile(dir, model.files[0].name);
    const magic = first ? new TextDecoder().decode(await first.slice(0, 4).arrayBuffer()) : '';
    complete = magic === 'GGUF';
  }
  return { complete, bytes };
}

export interface ModelDiskState {
  downloadedBytes: number;
  totalBytes: number;
  installed: boolean;
  location: ModelLocation | null;
}

export async function getModelDiskState(model: LocalModel): Promise<ModelDiskState> {
  const totalBytes = model.files.reduce((sum, file) => sum + file.sizeBytes, 0);
  const inFolder = await isComplete(model, await getModelDir('folder', model.id));
  if (inFolder.complete) return { downloadedBytes: totalBytes, totalBytes, installed: true, location: 'folder' };
  const inBrowser = await isComplete(model, await getModelDir('browser', model.id));
  return {
    downloadedBytes: inBrowser.bytes,
    totalBytes,
    installed: inBrowser.complete,
    location: inBrowser.complete ? 'browser' : null,
  };
}

/** The model's files as Blobs, in catalog order, ready for wllama.loadModel. */
export async function getModelBlobs(model: LocalModel): Promise<File[]> {
  const { location } = await getModelDiskState(model);
  const dir = location ? await getModelDir(location, model.id) : null;
  if (!dir) throw new Error('model_not_downloaded');
  const files: File[] = [];
  for (const entry of model.files) {
    const file = await getFile(dir, entry.name);
    if (!file || file.size !== entry.sizeBytes) throw new Error('model_incomplete');
    files.push(file);
  }
  return files;
}

/**
 * Copies a complete browser-stored model into the models folder, verifies
 * it, then removes the browser copy unless `keepBrowserCopy` (the engine may
 * still be reading it; it's cleaned up on a later visit).
 */
export async function moveModelToFolder(model: LocalModel, keepBrowserCopy: boolean): Promise<boolean> {
  const source = await getModelDir('browser', model.id);
  const target = await getModelDir('folder', model.id, true);
  if (!source || !target || !(await isComplete(model, source)).complete) return false;

  for (const entry of model.files) {
    const file = await getFile(source, entry.name);
    if (!file) return false;
    const writable = await (await target.getFileHandle(entry.name, { create: true })).createWritable();
    await file.stream().pipeTo(writable); // closes the writable when done
  }
  if (!(await isComplete(model, target)).complete) return false;
  if (!keepBrowserCopy) await removeBrowserCopy(model.id);
  return true;
}

/** Deletes the browser copy when a complete folder copy exists. */
export async function cleanUpBrowserCopy(model: LocalModel): Promise<void> {
  const folderCopy = await isComplete(model, await getModelDir('folder', model.id));
  if (folderCopy.complete) await removeBrowserCopy(model.id);
}

async function removeBrowserCopy(modelId: string): Promise<void> {
  try {
    await (await opfsModels()).removeEntry(modelId, { recursive: true });
  } catch {
    // Already gone.
  }
}

export async function deleteModel(modelId: string): Promise<void> {
  await removeBrowserCopy(modelId);
  const folder = await getUsableFolder();
  try {
    await folder?.removeEntry(modelId, { recursive: true });
  } catch {
    // Not in the folder.
  }
}
