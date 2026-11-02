import { Fragment, useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Cloud, CreditCard, Crown, Download, HardDrive, KeyRound, Settings2, Zap } from 'lucide-react';
import { allLocalModels, modelSizeBytes } from '../catalog';
import { useCustomModels } from '../customModels';
import type { Account } from '../cloud/account';
import type { CloudCatalog, CloudModel } from '../cloud/catalog';
import { groupModels } from '../cloud/groups';
import type { ModelChoice } from '../models';
import type { ProviderAccount } from '../providers/accounts';
import { CLAUDE_AGENT } from '../providers/claudeAgent';
import { exactModel, useClaudeModels } from '../providers/claudeCatalog';
import { readableModel } from '../chat/modelName';
import type { OwnModel } from '../providers/ownModels';
import type { DownloadState } from '../storage/downloads';
import { ClaudeAgentModels } from './ClaudeAgentModels';
import { CloudModelRow } from './CloudModelRow';
import { formatBytes, percent } from './format';
import { DeviceIcon } from './chat/Where';
import { visibleRows } from './pickerRows';

interface ModelPickerProps {
  choice: ModelChoice | null;
  catalog: CloudCatalog | null;
  account: Account | null;
  downloads: Record<string, DownloadState>;
  /** `cloud:<id>`, `local:<id>` or `own:<id>`. */
  onChoose: (key: string) => void;
  onManage: () => void;
  /** Opens Models & storage on the tab for the user's own API keys. */
  onOpenKeys: () => void;
  /** The models the user chose to use with their own keys, and the providers they belong to. */
  own: OwnModel[];
  providers: ProviderAccount[];
  onOpenAccount: () => void;
}

/**
 * The current model, in the message box's row of controls (the exact model, where its name doesn't say it); opens a
 * menu upwards to switch, download or buy credits.
 * Every cloud model is listed, the most capable ones included. The ones this
 * person can't use yet are locked, and choosing one opens the paywall (App.choose).
 */
export function ModelPicker({ choice, catalog, account, downloads, onChoose, onManage, onOpenKeys, own, providers, onOpenAccount }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  // Sections opened with "Show more"; the menu opens short again next time.
  const [more, setMore] = useState<Set<string>>(new Set());
  useEffect(() => { if (!open) setMore(new Set()); }, [open]);
  const claudeOffered = useClaudeModels();
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
  // The exact model, where the name doesn't say it: "claude-sonnet-5-5" for Claude Agent's "Sonnet".
  const exact = choice?.kind === 'own' ? exactModel(choice.model, choice.provider.id === CLAUDE_AGENT.id ? claudeOffered : []) : null;
  // Shown once: the exact model as a name ("Claude Sonnet 5.5"), or the name chosen; the id is in the tooltip.
  const shown = choice ? readableModel(exact) ?? choice.model.name : 'Choose a model';
  useCustomModels();
  const models = allLocalModels();
  const installed = models.filter(m => downloads[m.id]?.status === 'installed');
  const busyDownload = (id: string) => ['downloading', 'waiting', 'verifying', 'moving'].includes(downloads[id]?.status ?? '');
  // Downloads under way come before the models not started.
  const notInstalled = models.filter(m => downloads[m.id]?.status !== 'installed' && !m.custom).sort((a, b) => Number(busyDownload(b.id)) - Number(busyDownload(a.id)));
  const { free, frontier, everyday } = groupModels(catalog);
  const credits = account?.user ? Math.floor(account.credits ?? 0) : 0;
  // A provider's models are listed while its key is saved (a server of the user's own may not need one).
  const ownGroups = providers
    .filter(p => (p.configured || p.info.custom) && p.info.id !== CLAUDE_AGENT.id)
    .map(p => ({ provider: p.info, models: own.filter(m => m.provider === p.info.id) }))
    .filter(group => group.models.length > 0);
  // Claude Agent lists everything Claude Code offers once it is known (ClaudeAgentModels), not only what was added.
  const claudeOwn = own.filter(m => m.provider === CLAUDE_AGENT.id);
  const showClaude = providers.some(p => p.info.id === CLAUDE_AGENT.id && p.configured) && (claudeOwn.length > 0 || claudeOffered.length > 0);
  const connected = providers.filter(p => p.configured).length;
  // Each section shows a few models (the one in use always among them) and a row that shows the rest.
  const section = <T,>(name: string, items: T[], isSelected: (item: T) => boolean) => visibleRows(items, isSelected, more.has(name));
  const moreRow = (name: string, hidden: number, what: string) => (hidden > 0 || more.has(name)) && (
    <button key={`more-${name}`} type="button" role="menuitem" className="menu-item more-row press" aria-expanded={more.has(name)} onClick={() => setMore(now => { const next = new Set(now); if (next.has(name)) next.delete(name); else next.add(name); return next; })}>
      <span className="grow"><span className="title">{more.has(name) ? 'Show fewer' : `Show ${hidden} more ${what}${hidden === 1 ? '' : 's'}`}</span></span>
      <ChevronDown size={16} className="more-chev" aria-hidden="true" />
    </button>
  );
  const device = section('device', [...installed, ...notInstalled], m => selected === `local:${m.id}`);
  const deviceShown = new Set(device.shown.map(m => m.id));
  const freeRows = section('cloud', free, m => selected === `cloud:${m.id}`);
  const frontierRows = section('frontier', frontier, m => selected === `cloud:${m.id}`);
  const everydayRows = section('everyday', everyday, m => selected === `cloud:${m.id}`);
  const cloudRow = (model: CloudModel) => (
    <CloudModelRow key={model.id} model={model} account={account} selected={selected === `cloud:${model.id}`} onPick={() => pick(`cloud:${model.id}`)} menu />
  );

  return (
    <div className="picker-anchor" ref={anchor}>
      <button type="button" className="chip press model-chip" data-where={!choice ? 'none' : choice.kind === 'local' ? 'device' : 'cloud'} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)} title={exact ? `${shown} (${exact})` : undefined}>
        {choice?.kind === 'cloud' ? <Cloud size={14} aria-hidden="true" /> : choice?.kind === 'own' ? <KeyRound size={13} aria-hidden="true" /> : choice ? <DeviceIcon size={14} /> : <span className="status-dot off" />}
        <span className="chip-name">{shown}</span>
        {choice && <span className="vh">{choice.kind === 'local' ? ', on this device' : choice.kind === 'own' ? `, with your ${choice.provider.name} key` : ', in the cloud'}</span>}
        <ChevronDown className="chev" size={13} />
      </button>

      {open && (
        <div className="popover glass thick wide up" role="menu">
          <div className="popover-scroll">
            <div className="popover-section"><HardDrive size={13} /> On this device <span className="section-note">Private, works offline</span></div>
            {installed.filter(model => deviceShown.has(model.id)).map(model => {
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
            {notInstalled.filter(model => deviceShown.has(model.id)).map(model => {
              const state = downloads[model.id];
              const busy = state && ['downloading', 'waiting', 'verifying', 'moving'].includes(state.status);
              return (
                <button key={model.id} className="menu-item press" role="menuitem" onClick={() => { onManage(); setOpen(false); }}>
                  <span className="grow">
                    <span className="title">{model.name}</span>
                    <span className="sub">{busy ? `Downloading, ${percent(state.loaded, state.total || modelSizeBytes(model))}%` : `Download, ${formatBytes(modelSizeBytes(model))}`}</span>
                  </span>
                  <Download size={17} color="var(--ink-3)" />
                </button>
              );
            })}
            {moreRow('device', device.hidden, 'offline model')}
            {showClaude && <ClaudeAgentModels own={claudeOwn} selected={selected} onPick={pick} />}
            {ownGroups.map(({ provider, models }) => {
              const rows = section(`own:${provider.id}`, models, m => selected === `own:${m.id}`);
              return (
              <Fragment key={provider.id}>
                <div className="popover-section"><KeyRound size={13} /> {provider.name} <span className="section-note">your key</span></div>
                {rows.shown.map(model => (
                  <button key={model.id} className="menu-item press" role="menuitemradio" aria-checked={selected === `own:${model.id}`} onClick={() => pick(`own:${model.id}`)}>
                    <span className="grow">
                      <span className="title">{model.name}</span>
                      {model.name !== model.apiModel && <span className="sub">{model.apiModel}</span>}
                    </span>
                    {selected === `own:${model.id}` && <Check className="check" size={18} />}
                  </button>
                ))}
                {moreRow(`own:${provider.id}`, rows.hidden, `${provider.name} model`)}
              </Fragment>
              );
            })}
            {free.length > 0 && <div className="popover-section"><Cloud size={13} /> Cloud</div>}
            {freeRows.shown.map(cloudRow)}
            {moreRow('cloud', freeRows.hidden, 'cloud model')}
            {frontier.length > 0 && (
              <div className="popover-section"><Crown size={13} /> Frontier models <span className="section-note">{credits > 0 ? `${credits.toLocaleString()} credits` : 'Pro or credits'}</span></div>
            )}
            {frontierRows.shown.map(cloudRow)}
            {moreRow('frontier', frontierRows.hidden, 'frontier model')}
            {everyday.length > 0 && <div className="popover-section"><Zap size={13} /> Fast &amp; affordable <span className="section-note">credits</span></div>}
            {everydayRows.shown.map(cloudRow)}
            {moreRow('everyday', everydayRows.hidden, 'model')}
          </div>

          <div className="menu-divider" />
          {account && (
            <button className="menu-item press" role="menuitem" onClick={() => { onOpenAccount(); setOpen(false); }}>
              <CreditCard size={18} color="var(--ink-2)" />
              <span className="grow"><span className="title">{account.plan === 'pro' ? 'Plan & credits' : 'Get Pro & credits'}</span></span>
              {account.credits != null && <span className="note">{Math.floor(account.credits)} credits</span>}
            </button>
          )}
          <button className="menu-item press" role="menuitem" onClick={() => { onOpenKeys(); setOpen(false); }}>
            <KeyRound size={18} color="var(--ink-2)" />
            <span className="grow"><span className="title">Your API keys</span></span>
            <span className="note">{connected ? `${connected} connected` : 'Use your own'}</span>
          </button>
          <button className="menu-item press" role="menuitem" onClick={() => { onManage(); setOpen(false); }}>
            <Settings2 size={18} color="var(--ink-2)" />
            <span className="grow"><span className="title">Offline models &amp; storage</span></span>
          </button>
        </div>
      )}
    </div>
  );
}
