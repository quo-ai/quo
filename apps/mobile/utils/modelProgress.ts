import type { ModelStatus } from '@/services/llm';

// Model bootstrap progress travels one 0-100 scale: 0-50 is the download
// phase, 50-100 the load phase. Maps it to a 0-100 percentage for whichever
// phase is active.
export function getPhaseDisplayProgress(status: ModelStatus | string, progress: number): number {
  if (status === 'downloading') {
    return Math.min(Math.max(progress * 2, 0), 100);
  }
  if (status === 'loading') {
    return Math.min(Math.max((progress - 50) * 2, 0), 100);
  }
  return 0;
}
