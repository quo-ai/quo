import { useEffect, useRef, useState } from 'react';
import { Crown, X } from 'lucide-react';
import { agentBridge, hasNativeEngine } from '../native';
import type { LocalModel } from '../catalog';
import type { DeviceProfile } from '../device';
import type { Account } from '../cloud/account';
import type { CloudCatalog } from '../cloud/catalog';
import { groupModels } from '../cloud/groups';
import type { DownloadState } from '../storage/downloads';
import { CloudModelRow } from './CloudModelRow';
import { CodeSettings } from './CodeSettings';
import { ExternalModels } from './ExternalModels';
import { KeysTab } from './keys/KeysTab';
import { ModelList } from './ModelList';
import { NativeStorage } from './NativeStorage';
import { StorageSettings } from './StorageSettings';

export type ModelsTab = 'device' | 'cloud' | 'keys' | 'code';

const LABELS: Record<ModelsTab, string> = { device: 'On this device', cloud: 'Cloud', keys: 'Your keys', code: 'Code' };

interface ModelsSheetProps {
  /** Which tab to open on. */
  initialTab?: ModelsTab;
  device: DeviceProfile | null;
  downloads: Record<string, DownloadState>;
  activeModelId: string | null;
  persisted: boolean | null;
  onUse: (model: LocalModel) => void;
  onClose: () => void;
  /** The cloud models, shown on their own tab (locked ones included). */
  catalog: CloudCatalog | null;
  account: Account | null;
  /** `cloud:<id>`, `local:<id>` or `own:<id>` for what chats run on now. */
  selectedKey: string | null;
  /** Switches chats to a cloud model, or to one used with the user's own key. */
  onChoose: (key: string) => void;
  onOpenPro: () => void;
}

export function ModelsSheet({ initialTab = 'device', device, downloads, activeModelId, persisted, onUse, onClose, catalog, account, selectedKey, onChoose, onOpenPro }: ModelsSheetProps) {
  const sheet = useRef<HTMLDivElement>(null);
  const { free, frontier, everyday } = groupModels(catalog);
  const hasCloud = free.length + frontier.length + everyday.length > 0;
  const tabs: ModelsTab[] = ['device', ...(hasCloud ? ['cloud' as const] : []), 'keys', ...(agentBridge() ? ['code' as const] : [])];
  const [chosen, setTab] = useState<ModelsTab>(initialTab);
  const tab = tabs.includes(chosen) ? chosen : 'device';

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
          <div className="segmented" role="tablist">
            {tabs.map(id => <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{LABELS[id]}</button>)}
          </div>
          {tab === 'keys' ? <KeysTab selectedKey={selectedKey} onChoose={onChoose} /> : tab === 'code' ? <CodeSettings downloads={downloads} /> : tab === 'cloud' ? (
            <div className="cloud-list">
              {free.map(model => <CloudModelRow key={model.id} model={model} account={account} selected={selectedKey === `cloud:${model.id}`} onPick={() => onChoose(`cloud:${model.id}`)} />)}
              {frontier.length > 0 && <div className="popover-section"><Crown size={13} /> Frontier models <span className="section-note">Pro or credits</span></div>}
              {frontier.map(model => <CloudModelRow key={model.id} model={model} account={account} selected={selectedKey === `cloud:${model.id}`} onPick={() => onChoose(`cloud:${model.id}`)} />)}
              {everyday.length > 0 && <div className="popover-section">Fast &amp; affordable <span className="section-note">credits</span></div>}
              {everyday.map(model => <CloudModelRow key={model.id} model={model} account={account} selected={selectedKey === `cloud:${model.id}`} onPick={() => onChoose(`cloud:${model.id}`)} />)}
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
