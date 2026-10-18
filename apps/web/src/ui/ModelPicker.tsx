import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Cloud, CreditCard, Crown, Download, HardDrive, Settings2, Zap } from 'lucide-react';
import { allLocalModels, modelSizeBytes } from '../catalog';
import { useCustomModels } from '../customModels';
import type { Account } from '../cloud/account';
import type { CloudCatalog, CloudModel } from '../cloud/catalog';
import { groupModels } from '../cloud/groups';
import type { ModelChoice } from '../models';
import type { DownloadState } from '../storage/downloads';
import { CloudModelRow } from './CloudModelRow';
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

/**
 * Toolbar pill: the current model; opens a menu to switch, download or buy credits.
 * Every cloud model is listed, the most capable ones included. The ones this
 * person can't use yet are locked, and choosing one opens the paywall (App.choose).
 */
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
  useCustomModels();
  const models = allLocalModels();
  const installed = models.filter(m => downloads[m.id]?.status === 'installed');
  const notInstalled = models.filter(m => downloads[m.id]?.status !== 'installed' && !m.custom);
  const { free, frontier, everyday } = groupModels(catalog);
  const credits = account?.user ? Math.floor(account.credits ?? 0) : 0;
  const cloudRow = (model: CloudModel) => (
    <CloudModelRow key={model.id} model={model} account={account} selected={selected === `cloud:${model.id}`} onPick={() => pick(`cloud:${model.id}`)} menu />
  );

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
            {free.length > 0 && <div className="popover-section"><Cloud size={13} /> Cloud</div>}
            {free.map(cloudRow)}
            {frontier.length > 0 && (
              <div className="popover-section"><Crown size={13} /> Frontier models <span className="section-note">{credits > 0 ? `${credits.toLocaleString()} credits` : 'Pro or credits'}</span></div>
            )}
            {frontier.map(cloudRow)}
            {everyday.length > 0 && <div className="popover-section"><Zap size={13} /> Fast &amp; affordable <span className="section-note">credits</span></div>}
            {everyday.map(cloudRow)}
          </div>

          <div className="menu-divider" />
          {account && (
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
