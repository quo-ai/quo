/**
 * Persistent storage: once granted, the browser won't evict this origin's
 * data (downloaded models, chats) when the disk runs low. Chrome/Edge grant
 * it silently for engaged or installed sites, Firefox asks the user, Safari
 * ties it to the site being added to the Dock / Home Screen.
 */

export async function isPersisted(): Promise<boolean> {
  try {
    return (await navigator.storage?.persisted?.()) ?? false;
  } catch {
    return false;
  }
}

export async function requestPersistence(): Promise<boolean> {
  try {
    if (await isPersisted()) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

export interface StorageEstimate {
  usage: number;
  quota: number;
  available: number;
}

export async function getStorageEstimate(): Promise<StorageEstimate | null> {
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return { usage, quota, available: Math.max(0, quota - usage) };
  } catch {
    return null;
  }
}
