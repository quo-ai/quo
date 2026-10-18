import { useEffect, useState } from 'react';
import { Check, HardDriveDownload, Pause, Play, X } from 'lucide-react';
import { getLocalModel, modelSizeBytes } from '../catalog';
import type { DownloadState } from '../storage/downloads';
import { formatBytes, percent } from './format';

interface OfflineModelCardProps {
  modelId: string;
  state: DownloadState | undefined;
  onPause: () => void;
  onResume: () => void;
}

const ACTIVE = ['downloading', 'waiting', 'verifying', 'moving'];

/**
 * The automatic offline-model download, shown as a small glass card while it
 * runs (pause/resume), a brief "ready" state, then it disappears.
 */
export function OfflineModelCard({ modelId, state, onPause, onResume }: OfflineModelCardProps) {
  const model = getLocalModel(modelId);
  const status = state?.status ?? 'idle';
  const [showReady, setShowReady] = useState(false);
  const [wasActive, setWasActive] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (ACTIVE.includes(status)) setWasActive(true);
    if (status === 'installed' && wasActive) {
      setShowReady(true);
      const timer = setTimeout(() => setShowReady(false), 3500);
      return () => clearTimeout(timer);
    }
  }, [status, wasActive]);

  if (!model || hidden) return null;
  const active = ACTIVE.includes(status);
  const paused = status === 'partial';
  if (!active && !paused && !showReady) return null;

  const total = state?.total || modelSizeBytes(model);
  const pct = percent(state?.loaded ?? 0, total);
  const label = showReady ? 'Offline model ready'
    : status === 'waiting' ? 'Waiting for connection'
      : status === 'verifying' ? 'Checking offline model'
        : status === 'moving' ? 'Saving to your folder'
          : paused ? 'Offline model paused' : 'Getting offline model';

  return (
    <div className={`offline-card glass thick${showReady ? ' ready' : ''}`} role="status" aria-live="polite">
      <span className="offline-icon">{showReady ? <Check size={16} strokeWidth={3} /> : <HardDriveDownload size={16} />}</span>
      <div className="offline-text">
        <strong>{label}</strong>
        <span>{showReady ? 'Works without internet, fully private' : `${model.name} · ${formatBytes(state?.loaded ?? 0)} of ${formatBytes(total)}`}</span>
        {!showReady && (
          <div className="progress mini" aria-hidden="true"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
        )}
      </div>
      {!showReady && (status === 'downloading' || status === 'waiting') && (
        <button className="icon-btn round press" onClick={onPause} aria-label="Pause download" title="Pause"><Pause size={15} /></button>
      )}
      {paused && (
        <>
          <button className="icon-btn round press" onClick={onResume} aria-label="Resume download" title="Resume"><Play size={15} /></button>
          <button className="icon-btn round press" onClick={() => setHidden(true)} aria-label="Hide" title="Hide"><X size={15} /></button>
        </>
      )}
    </div>
  );
}
