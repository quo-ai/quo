import { openDB } from 'idb';

/**
 * "Keep models in a folder on this computer" (Chromium: File System Access
 * API). Models in a user-chosen folder are ordinary files, so they survive
 * even "clear all site data"; if that happens, picking the folder again
 * finds them without re-downloading.
 *
 * Layout: <chosen folder>/Quo Models/<modelId>/<file>. The folder handle is
 * kept in IndexedDB; browsers may ask for permission again on a later visit,
 * which needs a click (reconnectFolder).
 */

const FOLDER_NAME = 'Quo Models';
const HANDLE_KEY = 'modelsFolder';

type PermissionMode = { mode: 'readwrite' };
interface PermissionedHandle extends FileSystemDirectoryHandle {
  queryPermission?: (descriptor: PermissionMode) => Promise<PermissionState>;
  requestPermission?: (descriptor: PermissionMode) => Promise<PermissionState>;
}
type DirectoryPicker = (options?: { id?: string; mode?: 'readwrite'; startIn?: string }) => Promise<FileSystemDirectoryHandle>;

export const folderSupported = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

const settings = () => openDB('quo-settings', 1, {
  upgrade(database) {
    database.createObjectStore('handles');
  },
});

export async function getSavedFolder(): Promise<FileSystemDirectoryHandle | null> {
  if (!folderSupported) return null;
  try {
    return ((await (await settings()).get('handles', HANDLE_KEY)) as FileSystemDirectoryHandle | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function folderPermission(handle: FileSystemDirectoryHandle): Promise<PermissionState> {
  try {
    return (await (handle as PermissionedHandle).queryPermission?.({ mode: 'readwrite' })) ?? 'granted';
  } catch {
    return 'denied';
  }
}

/** The saved folder if it's usable right now without prompting. */
export async function getUsableFolder(): Promise<FileSystemDirectoryHandle | null> {
  const handle = await getSavedFolder();
  return handle && (await folderPermission(handle)) === 'granted' ? handle : null;
}

/** Must run from a click: shows the system folder picker. */
export async function chooseFolder(): Promise<FileSystemDirectoryHandle | null> {
  const picker = (window as unknown as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;
  if (!picker) return null;
  let picked: FileSystemDirectoryHandle;
  try {
    picked = await picker({ id: 'quo-models', mode: 'readwrite', startIn: 'documents' });
  } catch {
    return null; // cancelled
  }
  // Accept the "Quo Models" folder itself or its parent; otherwise create it.
  const folder = picked.name === FOLDER_NAME
    ? picked
    : await picked.getDirectoryHandle(FOLDER_NAME, { create: true });
  await (await settings()).put('handles', folder, HANDLE_KEY);
  return folder;
}

/** Must run from a click: re-grants access to the saved folder. */
export async function reconnectFolder(): Promise<boolean> {
  const handle = (await getSavedFolder()) as PermissionedHandle | null;
  if (!handle) return false;
  try {
    return (await handle.requestPermission?.({ mode: 'readwrite' })) === 'granted';
  } catch {
    return false;
  }
}

/** Stops using the folder. The files in it are left alone. */
export async function forgetFolder(): Promise<void> {
  await (await settings()).delete('handles', HANDLE_KEY);
}
