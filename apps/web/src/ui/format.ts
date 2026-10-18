export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.max(0, Math.round(bytes / 1e3))} KB`;
}

export function percent(loaded: number, total: number): number {
  return total > 0 ? Math.min(100, Math.floor((loaded / total) * 100)) : 0;
}

const ERROR_TEXT: Record<string, string> = {
  storage_full: 'Not enough storage space on this device.',
  size_mismatch: 'The download didn’t match the expected file. Try again.',
  invalid_model_file: 'The downloaded file was damaged. Try again.',
  busy: 'This model is being downloaded in another tab.',
  worker_failed: 'This browser couldn’t run the download.',
  no_space: 'Not enough free disk space for this model.',
  not_gguf: 'The downloaded file wasn’t a valid model. Try again.',
  bad_url: 'That download address isn’t allowed.',
  download_failed: 'Download failed. Try again.',
};

export function downloadErrorText(code?: string): string {
  if (!code) return 'Download failed. Try again.';
  if (code.startsWith('http_')) return 'The model server is unavailable right now. Try again later.';
  return ERROR_TEXT[code] ?? 'Download failed. Try again.';
}

/** "just now", "5 minutes ago", "yesterday"… for a past time. */
export function timeAgo(then: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}
