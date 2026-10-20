import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Boxes, Brain, Keyboard, ChevronRight, Cloud, CloudAlert, Code2, Crown, Globe, KeyRound, MonitorDown, RefreshCw, UserRound, X } from 'lucide-react';
import type { Account } from '../cloud/account';
import { listMemories, onMemoriesChanged } from '../memory/store';
import { agentBridge } from '../native';
import { useSyncStatus } from '../sync';
import type { ModelsTab } from './ModelsSheet';
import { AppearancePicker } from './AppearancePicker';

/** What a row of Settings opens. */
export type SettingsTarget = { kind: 'models'; tab: ModelsTab } | { kind: 'memories' } | { kind: 'sync' } | { kind: 'account' } | { kind: 'pro' } | { kind: 'getapp' } | { kind: 'shortcuts' };

interface SettingsSheetProps {
  /** Null when the Quo API can't be reached; the account rows are left out then. */
  account: Account | null;
  installedCount: number;
  /** Whether Quo's cloud models are listed at all. */
  hasCloud: boolean;
  onOpen: (target: SettingsTarget) => void;
  onClose: () => void;
}

function Row({ icon, label, detail, value, onClick }: { icon: ReactNode; label: string; detail?: string; value?: ReactNode; onClick: () => void }) {
  return (
    <button className="settings-row press" onClick={onClick}>
      <span className="settings-icon">{icon}</span>
      <span className="settings-text">
        <span className="settings-label">{label}</span>
        {detail && <span className="settings-detail">{detail}</span>}
      </span>
      {value !== undefined && <span className="settings-value">{value}</span>}
      <ChevronRight size={16} className="settings-chevron" />
    </button>
  );
}

/**
 * Everything adjustable in one place, for everyone: signed in or not, with or without the cloud. Each row opens the
 * sheet that already does the job, and closing that sheet comes back here (App.tsx).
 */
export function SettingsSheet({ account, installedCount, hasCloud, onOpen, onClose }: SettingsSheetProps) {
  const sheet = useRef<HTMLDivElement>(null);
  const sync = useSyncStatus();
  const [memoryCount, setMemoryCount] = useState<number | null>(null);

  useEffect(() => {
    sheet.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let current = true;
    const load = () => void listMemories().then(list => current && setMemoryCount(list.length)).catch(() => {});
    load();
    const stop = onMemoriesChanged(load);
    return () => {
      current = false;
      stop();
    };
  }, []);

  const syncNeedsAttention = sync.phase === 'error' && sync.error?.code !== 'offline';
  const syncText = sync.phase === 'off' ? 'Off' : sync.phase === 'syncing' ? 'Syncing…' : sync.phase === 'error' ? (sync.error?.code === 'offline' ? 'Offline' : 'Needs attention') : 'On';
  const models = (tab: ModelsTab): SettingsTarget => ({ kind: 'models', tab });

  return (
    <div className="scrim" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="sheet glass thick" role="dialog" aria-modal="true" aria-labelledby="settings-title" tabIndex={-1} ref={sheet}>
        <div className="sheet-head">
          <h2 id="settings-title">Settings</h2>
          <button className="icon-btn round press" onClick={onClose} aria-label="Close"><X size={19} /></button>
        </div>
        <div className="sheet-body">
          <div className="sheet-section-title">Appearance</div>
          <AppearancePicker />

          <div className="sheet-section-title">Chat</div>
          <Row icon={<Brain size={18} />} label="Memories" detail="Things you’ve asked Quo to remember" value={memoryCount === null ? undefined : memoryCount === 0 ? 'None yet' : `${memoryCount} saved`} onClick={() => onOpen({ kind: 'memories' })} />
          <Row icon={syncNeedsAttention ? <CloudAlert size={18} /> : <RefreshCw size={18} className={sync.phase === 'syncing' ? 'spin' : undefined} />} label="Quo Sync" detail="Keep chats and memories on your devices, end-to-end encrypted" value={syncText} onClick={() => onOpen({ kind: 'sync' })} />

          <div className="sheet-section-title">Models &amp; tools</div>
          <Row icon={<Boxes size={18} />} label="Offline models and storage" detail="Run on this device, free, works offline" value={installedCount ? `${installedCount} on device` : 'None yet'} onClick={() => onOpen(models('device'))} />
          {hasCloud && <Row icon={<Cloud size={18} />} label="Cloud models" detail="Faster and stronger, sent to the model’s provider" onClick={() => onOpen(models('cloud'))} />}
          <Row icon={<KeyRound size={18} />} label="Your own API keys" detail="Use your accounts with other providers" onClick={() => onOpen(models('keys'))} />
          <Row icon={<Globe size={18} />} label="Web search" detail="Let models look things up" onClick={() => onOpen(models('web'))} />
          {agentBridge() && <Row icon={<Code2 size={18} />} label="Code mode" detail="Commands, commits and what Quo asks before doing" onClick={() => onOpen(models('code'))} />}

          {account && (
            <>
              <div className="sheet-section-title">Account</div>
              {account.user ? (
                <Row icon={<UserRound size={18} />} label={account.user.email} detail="Plan, credits and purchases" value={account.plan === 'pro' ? <span className="badge"><Crown size={11} /> Pro</span> : `${Math.floor(account.credits ?? 0).toLocaleString()} credits`} onClick={() => onOpen({ kind: 'account' })} />
              ) : (
                <Row icon={<UserRound size={18} />} label="Sign in" detail="Optional. For cloud models, credits and Quo Sync. Quo works without it." onClick={() => onOpen({ kind: 'account' })} />
              )}
              {account.plan !== 'pro' && <Row icon={<Crown size={18} />} label="Quo Pro" detail="What it adds" onClick={() => onOpen({ kind: 'pro' })} />}
            </>
          )}

          <div className="sheet-section-title">About</div>
          <Row icon={<Keyboard size={18} />} label="Keyboard shortcuts" detail="Everything you can do without the mouse" onClick={() => onOpen({ kind: 'shortcuts' })} />
          <Row icon={<MonitorDown size={18} />} label="Get the app" detail="Faster, and works with your own files" onClick={() => onOpen({ kind: 'getapp' })} />
        </div>
      </div>
    </div>
  );
}
