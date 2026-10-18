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
};

export function downloadErrorText(code?: string): string {
  if (!code) return 'Download failed. Try again.';
  if (code.startsWith('http_')) return 'The model server is unavailable right now. Try again later.';
  return ERROR_TEXT[code] ?? 'Download failed. Try again.';
}
