import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Cloud, CreditCard, Download, HardDrive, Settings2 } from 'lucide-react';
import { LOCAL_MODELS, modelSizeBytes } from '../catalog';
import { accountsEnabled, type Account } from '../cloud/account';
import type { CloudCatalog } from '../cloud/catalog';
import type { ModelChoice } from '../models';
import type { DownloadState } from '../storage/downloads';
import { formatBytes, percent } from './format';

interface ModelPickerProps {
  choice: ModelChoice | null;
  catalog: CloudCatalog | null;
  account: Account | null;
  downloads: Record<string, DownloadState>;
  /** `cloud:<id>` or `local:<id>`. */
  onChoose: (key: string) => void;
  onManage: () => void;
  onOpenAccount: () => void;
}

/** Toolbar pill: the current model; opens a menu to switch, download or buy credits. */
export function ModelPicker({ choice, catalog, account, downloads, onChoose, onManage, onOpenAccount }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!anchor.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (key: string) => {
    onChoose(key);
    setOpen(false);
  };
  const selected = choice ? `${choice.kind}:${choice.model.id}` : null;
  const installed = LOCAL_MODELS.filter(m => downloads[m.id]?.status === 'installed');
  const notInstalled = LOCAL_MODELS.filter(m => downloads[m.id]?.status !== 'installed');
  const cloudModels = catalog ? [...catalog.models].sort((a, b) => Number(b.free) - Number(a.free)) : [];
  const signedIn = Boolean(account?.user);

  return (
    <div className="picker-anchor" ref={anchor}>
      <button className="model-pill glass press" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        {choice?.kind === 'cloud' ? <Cloud size={16} color="var(--indigo)" /> : <span className={`status-dot${choice ? '' : ' off'}`} />}
        {choice ? choice.model.name : 'Choose a model'}
        <ChevronDown className="chev" size={16} />
      </button>

      {open && (
        <div className="popover glass thick wide" role="menu">
          <div className="popover-scroll">
            <div className="popover-section"><HardDrive size={13} /> On this device · private · offline</div>
            {installed.map(model => {
              const key = `local:${model.id}`;
              return (
                <button key={key} className="menu-item press" role="menuitemradio" aria-checked={selected === key} onClick={() => pick(key)}>
                  <span className="grow">
                    <span className="title">{model.name}</span>
                    <span className="sub">{model.description}</span>
                  </span>
                  {selected === key && <Check className="check" size={18} />}
                </button>
              );
            })}
            {notInstalled.map(model => {
              const state = downloads[model.id];
              const busy = state && ['downloading', 'waiting', 'verifying', 'moving'].includes(state.status);
              return (
                <button key={model.id} className="menu-item press" role="menuitem" onClick={() => { onManage(); setOpen(false); }}>
                  <span className="grow">
                    <span className="title">{model.name}</span>
                    <span className="sub">{busy ? `Downloading · ${percent(state.loaded, state.total || modelSizeBytes(model))}%` : `Download · ${formatBytes(modelSizeBytes(model))}`}</span>
                  </span>
                  <Download size={17} color="var(--text-3)" />
                </button>
              );
            })}
            {cloudModels.length > 0 && <div className="popover-section"><Cloud size={13} /> Cloud</div>}
            {cloudModels.map(model => {
              const key = `cloud:${model.id}`;
              const sub = model.free
                ? `Free · ${account ? `${account.free.remaining} left today` : 'every day'}`
                : `≈ ${model.creditsPerMessage < 1 ? model.creditsPerMessage.toFixed(1) : Math.round(model.creditsPerMessage)} credit${model.creditsPerMessage === 1 ? '' : 's'} per message${signedIn ? '' : ' · sign in'}`;
              return (
                <button key={key} className="menu-item press" role="menuitemradio" aria-checked={selected === key} onClick={() => pick(key)}>
                  <span className="grow">
                    <span className="title">{model.name} {model.free && <span className="badge green">Free</span>}</span>
                    <span className="sub">{model.provider} · {sub}</span>
                  </span>
                  {selected === key && <Check className="check" size={18} />}
                </button>
              );
            })}

          </div>

          <div className="menu-divider" />
          {account && accountsEnabled(account) && (
            <button className="menu-item press" role="menuitem" onClick={() => { onOpenAccount(); setOpen(false); }}>
              <CreditCard size={18} color="var(--text-2)" />
              <span className="grow"><span className="title">{account.plan === 'pro' ? 'Plan & credits' : 'Get Pro & credits'}</span></span>
              {account.credits != null && <span className="note">{Math.floor(account.credits)} credits</span>}
            </button>
          )}
          <button className="menu-item press" role="menuitem" onClick={() => { onManage(); setOpen(false); }}>
            <Settings2 size={18} color="var(--text-2)" />
            <span className="grow"><span className="title">Offline models &amp; storage</span></span>
          </button>
        </div>
      )}
    </div>
  );
}
