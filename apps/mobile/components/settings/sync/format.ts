import { ApiError } from '@/services/sync/api';
import type { getCloudStatus } from '@/services/sync';

export type CloudStatus = Awaited<ReturnType<typeof getCloudStatus>>;

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

export const formatBytes = (bytes: number) => (bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(0, Math.round(bytes / 1e3))} KB`);
export const errorText = (error: unknown, fallback: string) => (error instanceof ApiError ? error.message : fallback);
