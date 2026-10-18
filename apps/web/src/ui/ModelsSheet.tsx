import { useEffect, useRef, useState } from 'react';
import { Crown, X } from 'lucide-react';
import { hasNativeEngine } from '../native';
import type { LocalModel } from '../catalog';
import type { DeviceProfile } from '../device';
import type { Account } from '../cloud/account';
import type { CloudCatalog } from '../cloud/catalog';
import { groupModels } from '../cloud/groups';
import type { DownloadState } from '../storage/downloads';
import { CloudModelRow } from './CloudModelRow';
import { ExternalModels } from './ExternalModels';
import { ModelList } from './ModelList';
import { NativeStorage } from './NativeStorage';
import { StorageSettings } from './StorageSettings';

interface ModelsSheetProps {
  device: DeviceProfile | null;
  downloads: Record<string, DownloadState>;
  activeModelId: string | null;
  persisted: boolean | null;
  onUse: (model: LocalModel) => void;
  onClose: () => void;
  /** The cloud models, shown on their own tab (locked ones included). */
  catalog: CloudCatalog | null;
  account: Account | null;
  /** `cloud:<id>` or `local:<id>` for what chats run on now. */
  selectedKey: string | null;
  onChooseCloud: (key: string) => void;
  onOpenPro: () => void;
}

export function ModelsSheet({ device, downloads, activeModelId, persisted, onUse, onClose, catalog, account, selectedKey, onChooseCloud, onOpenPro }: ModelsSheetProps) {
  const sheet = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<'device' | 'cloud'>('device');
  const { free, frontier, everyday } = groupModels(catalog);
  const hasCloud = free.length + frontier.length + everyday.length > 0;

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
          {hasCloud && (
            <div className="segmented" role="tablist">
              <button role="tab" aria-selected={tab === 'device'} onClick={() => setTab('device')}>On this device</button>
              <button role="tab" aria-selected={tab === 'cloud'} onClick={() => setTab('cloud')}>Cloud</button>
            </div>
          )}
          {tab === 'cloud' && hasCloud ? (
            <div className="cloud-list">
              {free.map(model => <CloudModelRow key={model.id} model={model} account={account} selected={selectedKey === `cloud:${model.id}`} onPick={() => onChooseCloud(`cloud:${model.id}`)} />)}
              {frontier.length > 0 && <div className="popover-section"><Crown size={13} /> Frontier models <span className="section-note">Pro or credits</span></div>}
              {frontier.map(model => <CloudModelRow key={model.id} model={model} account={account} selected={selectedKey === `cloud:${model.id}`} onPick={() => onChooseCloud(`cloud:${model.id}`)} />)}
              {everyday.length > 0 && <div className="popover-section">Fast &amp; affordable <span className="section-note">credits</span></div>}
              {everyday.map(model => <CloudModelRow key={model.id} model={model} account={account} selected={selectedKey === `cloud:${model.id}`} onPick={() => onChooseCloud(`cloud:${model.id}`)} />)}
              {account?.plan !== 'pro' && <p className="note cloud-note">Cloud messages are sent to the model’s provider. <button className="btn-link" onClick={onOpenPro}>What’s in Quo Pro?</button></p>}
            </div>
          ) : (
            <>
          <div className="sheet-section-title">Runs on this device · free · works offline</div>
          <ModelList device={device} downloads={downloads} activeModelId={activeModelId} onUse={onUse} />
          {hasNativeEngine() && (
            <>
              <div className="sheet-section-title">Models you already have</div>
              <ExternalModels />
            </>
          )}
          <div className="sheet-section-title">Storage</div>
          {hasNativeEngine() ? <NativeStorage /> : <StorageSettings persisted={persisted} />}
          {device && (
            <p className="note" style={{ marginTop: 14 }}>
              {device.native ? (device.gpu ? `Using your graphics card (${device.gpuName}) for fast replies.` : 'No supported graphics card found, so models run on your processor.') : device.gpu ? `Using your graphics card${device.gpuName ? ` (${device.gpuName})` : ''} for faster replies.` : 'Running on your processor. Chrome or Edge can use your graphics card for faster replies.'}
            </p>
          )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
