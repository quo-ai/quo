import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import type { LocalModel } from '../catalog';
import type { DeviceProfile } from '../device';
import type { DownloadState } from '../storage/downloads';
import { ModelList } from './ModelList';
import { StorageSettings } from './StorageSettings';

interface ModelsSheetProps {
  device: DeviceProfile | null;
  downloads: Record<string, DownloadState>;
  activeModelId: string | null;
  persisted: boolean | null;
  onUse: (model: LocalModel) => void;
  onClose: () => void;
}

export function ModelsSheet({ device, downloads, activeModelId, persisted, onUse, onClose }: ModelsSheetProps) {
  const sheet = useRef<HTMLDivElement>(null);

  useEffect(() => {
    sheet.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="scrim" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="sheet glass thick" role="dialog" aria-modal="true" aria-labelledby="models-title" tabIndex={-1} ref={sheet}>
        <div className="sheet-head">
          <h2 id="models-title">Models &amp; storage</h2>
          <button className="icon-btn round press" onClick={onClose} aria-label="Close"><X size={19} /></button>
        </div>
        <div className="sheet-body">
          <div className="sheet-section-title">Runs on this device · free · works offline</div>
          <ModelList device={device} downloads={downloads} activeModelId={activeModelId} onUse={onUse} />
          <div className="sheet-section-title">Storage</div>
          <StorageSettings persisted={persisted} />
          {device && (
            <p className="note" style={{ marginTop: 14 }}>
              {device.gpu ? `Using your graphics card${device.gpuName ? ` (${device.gpuName})` : ''} for faster replies.` : 'Running on your processor. Chrome or Edge can use your graphics card for faster replies.'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
