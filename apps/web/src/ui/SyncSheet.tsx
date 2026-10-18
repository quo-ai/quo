import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { AlertCircle, Check, Cloud, CloudOff, Copy, Download, KeyRound, Loader2, Lock, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { ApiError, checkout, type Account } from '../cloud/account';
import { newRecoveryKey } from '../sync/crypto';
import { createSync, deleteCloudCopy, disableSync, getCloudStatus, joinSync, JoinError, syncNow, useSyncStatus } from '../sync';
import { formatBytes, percent, timeAgo } from './format';
import { toast } from './Toasts';

type Cloud = Awaited<ReturnType<typeof getCloudStatus>>;

interface SyncSheetProps {
  account: Account | null;
  onClose: () => void;
  onOpenAccount: () => void;
}

const POINTS = [
  [Lock, 'End-to-end encrypted. Your chats are scrambled on your device with a key only you hold, so Quo can’t read them.'],
  [RefreshCw, 'Chats and memories follow you between Quo Web, the desktop app and the Android app.'],
  [ShieldCheck, 'Photos and files stay on the device they were added on. Models are never synced.'],
] as const;

/** Quo Sync: turn it on, join it from another device, see how it's doing. */
export function SyncSheet({ account, onClose, onOpenAccount }: SyncSheetProps) {
  const sheet = useRef<HTMLDivElement>(null);
  const sync = useSyncStatus();
  const [cloud, setCloud] = useState<Cloud | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const signedIn = Boolean(account?.user);

  useEffect(() => {
    sheet.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const load = useCallback(async () => {
    if (!signedIn) return;
    try {
      setCloud(await getCloudStatus());
      setProblem(null);
    } catch (error) {
      setProblem(error instanceof ApiError ? error.message : 'Couldn’t reach Quo Sync. Try again.');
    }
  }, [signedIn]);

  useEffect(() => {
    void load();
  }, [load, sync.phase === 'off']);

  return (
    <div className="scrim" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="sheet glass thick" role="dialog" aria-modal="true" aria-labelledby="sync-title" tabIndex={-1} ref={sheet}>
        <div className="sheet-head">
          <h2 id="sync-title">Quo Sync</h2>
          <button className="icon-btn round press" onClick={onClose} aria-label="Close"><X size={19} /></button>
        </div>
        <div className="sheet-body">
          {sync.phase !== 'off'
            ? <Connected cloud={cloud} onChanged={load} />
            : (
              <>
                <p className="auth-lede">Keep your chats and memories on all your devices, privately.</p>
                <ul className="sync-points">
                  {POINTS.map(([Icon, text]) => <li key={text}><Icon size={16} /><span>{text}</span></li>)}
                </ul>
                {!signedIn
                  ? <SignInPrompt onOpenAccount={onOpenAccount} />
                  : problem && !cloud
                    ? <ProblemBox message={problem} onRetry={load} />
                    : cloud && !cloud.entitled
                      ? <GetPlan />
                      : cloud
                        ? <TurnOn email={account!.user!.email} alreadySetUp={cloud.enabled} onDone={load} />
                        : <p className="note"><Loader2 size={14} className="spin" style={{ verticalAlign: -2 }} /> Checking…</p>}
              </>
            )}
        </div>
      </div>
    </div>
  );
}

function ProblemBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="storage-box">
      <p><AlertCircle size={14} style={{ verticalAlign: -2, marginRight: 6 }} />{message}</p>
      <button className="btn btn-soft press" onClick={() => void onRetry()}>Try again</button>
    </div>
  );
}

function SignInPrompt({ onOpenAccount }: { onOpenAccount: () => void }) {
  return (
    <div className="storage-box">
      <p>Quo Sync needs a Quo account, so it knows which chats are yours. Sign in with just your email, no password.</p>
      <button className="btn btn-primary press" onClick={onOpenAccount}>Sign in</button>
    </div>
  );
}

function GetPlan() {
  const [busy, setBusy] = useState<string | null>(null);
  async function buy(product: 'sync_yearly' | 'pro_monthly' | 'pro_yearly') {
    setBusy(product);
    try {
      await checkout(product);
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Checkout isn’t available right now.');
      setBusy(null);
    }
  }
  return (
    <div className="storage-box">
      <p>Quo Sync is included with <strong>Quo Pro</strong>, or you can get it on its own.</p>
      <div className="model-actions">
        <button className="btn btn-primary press" disabled={Boolean(busy)} onClick={() => void buy('sync_yearly')}>Quo Sync · $24 / year</button>
        <button className="btn btn-soft press" disabled={Boolean(busy)} onClick={() => void buy('pro_yearly')}>Quo Pro · $99 / year</button>
      </div>
      <p className="note" style={{ marginTop: 10 }}>Your chats stay on your device and work offline either way. Sync is only for keeping them in step.</p>
    </div>
  );
}

function TurnOn({ email, alreadySetUp, onDone }: { email: string; alreadySetUp: boolean; onDone: () => void }) {
  const [mode, setMode] = useState<'intro' | 'create' | 'join'>(alreadySetUp ? 'join' : 'intro');
  return mode === 'join'
    ? <Join email={email} onDone={onDone} />
    : mode === 'create'
      ? <Create email={email} onBack={() => setMode('intro')} onDone={onDone} />
      : (
        <div className="storage-box">
          <p>You’ll get a <strong>recovery key</strong>: the only thing that can unlock your synced chats on a new device. Quo can’t reset it for you.</p>
          <button className="btn btn-primary press" onClick={() => setMode('create')}><KeyRound size={15} /> Turn on Quo Sync</button>
        </div>
      );
}

function Create({ email, onBack, onDone }: { email: string; onBack: () => void; onDone: () => void }) {
  const [recovery] = useState(newRecoveryKey);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(recovery.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast('Couldn’t copy. Select the key and copy it by hand.');
    }
  }

  function download() {
    const file = new Blob([`Quo Sync recovery key for ${email}\n\n${recovery.text}\n\nKeep this somewhere safe. It's the only way to unlock your synced chats on a new device, and Quo can't recover it.\n`], { type: 'text/plain' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(file);
    link.download = 'quo-recovery-key.txt';
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function start() {
    setBusy(true);
    setError(null);
    try {
      await createSync(recovery.secret, email);
      toast('Quo Sync is on');
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Couldn’t turn on Quo Sync. Try again.');
      setBusy(false);
    }
  }

  return (
    <div className="storage-box">
      <p><strong>Save your recovery key.</strong> You’ll need it to add another device. It’s shown only now, and if it’s lost, so are your synced chats (the chats on your devices stay).</p>
      <div className="recovery-key" aria-label="Recovery key" onClick={event => window.getSelection()?.selectAllChildren(event.currentTarget)}>{recovery.text}</div>
      <div className="model-actions">
        <button className="btn btn-soft press" onClick={() => void copy()}>{copied ? <><Check size={15} /> Copied</> : <><Copy size={15} /> Copy</>}</button>
        <button className="btn btn-soft press" onClick={download}><Download size={15} /> Save as a file</button>
      </div>
      <label className="check">
        <input type="checkbox" checked={saved} onChange={event => setSaved(event.target.checked)} />
        <span>I’ve saved my recovery key somewhere safe, and I understand Quo can’t recover it.</span>
      </label>
      {error && <p className="error">{error}</p>}
      <div className="model-actions" style={{ marginTop: 12 }}>
        <button className="btn btn-primary press" disabled={!saved || busy} onClick={() => void start()}>{busy ? 'Turning on…' : 'Turn on Quo Sync'}</button>
        <button className="btn btn-ghost press" disabled={busy} onClick={onBack}>Back</button>
      </div>
    </div>
  );
}

function Join({ email, onDone }: { email: string; onDone: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  async function join(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await joinSync(text, email);
      toast('Quo Sync is on. Your chats are on their way.');
      onDone();
    } catch (err) {
      setError(
        err instanceof JoinError
          ? err.code === 'bad_format' ? 'That recovery key doesn’t look right. Check it for typos: it’s 8 groups of 4 letters and numbers, then 2 more.'
            : err.code === 'wrong_key' ? 'That recovery key doesn’t match this account’s Quo Sync.'
              : 'Quo Sync isn’t turned on for this account yet.'
          : err instanceof ApiError ? err.message : 'Couldn’t join Quo Sync. Try again.',
      );
      setBusy(false);
    }
  }

  async function startOver() {
    setBusy(true);
    try {
      await deleteCloudCopy();
      toast('The cloud copy was deleted. You can turn Quo Sync on again.');
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Couldn’t delete it. Try again.');
    } finally {
      setBusy(false);
      setConfirmReset(false);
    }
  }

  return (
    <form className="storage-box" onSubmit={event => void join(event)}>
      <p>Quo Sync is already on for <strong>{email}</strong>. Enter your recovery key to bring those chats here.</p>
      <label className="field-wrap">
        <KeyRound size={17} />
        <input className="field mono" autoFocus spellCheck={false} autoCapitalize="characters" autoComplete="off" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XX" value={text} onChange={event => setText(event.target.value)} aria-label="Recovery key" />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="model-actions" style={{ marginTop: 12 }}>
        <button className="btn btn-primary press" disabled={busy || !text.trim()}>{busy ? 'Checking…' : 'Join Quo Sync'}</button>
      </div>
      <p className="note" style={{ marginTop: 14 }}>
        Lost your key? Nobody can recover it, but you can{' '}
        {confirmReset
          ? <><button type="button" className="btn-link" style={{ color: 'var(--error)' }} disabled={busy} onClick={() => void startOver()}>delete the cloud copy for good</button> (chats on your devices stay).</>
          : <button type="button" className="btn-link" onClick={() => setConfirmReset(true)}>delete the cloud copy and start again</button>}
      </p>
    </form>
  );
}

function Connected({ cloud, onChanged }: { cloud: Cloud | null; onChanged: () => void }) {
  const sync = useSyncStatus();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const label = sync.phase === 'syncing' ? 'Syncing…'
    : sync.phase === 'error' ? (sync.error?.code === 'offline' ? 'Offline' : 'Needs attention')
      : sync.lastSyncAt ? `Up to date · ${timeAgo(sync.lastSyncAt)}` : 'Starting…';

  async function turnOff() {
    await disableSync();
    toast('Quo Sync is off on this device. Your chats stay here and in the cloud.');
    onChanged();
  }

  async function deleteAll() {
    setBusy(true);
    try {
      await deleteCloudCopy();
      toast('The cloud copy was deleted.');
      onChanged();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Couldn’t delete it. Try again.');
      setBusy(false);
    }
  }

  return (
    <>
      <div className={`sync-state ${sync.phase}`}>
        {sync.phase === 'syncing' ? <Loader2 size={18} className="spin" /> : sync.phase === 'error' ? <CloudOff size={18} /> : <Cloud size={18} />}
        <div>
          <strong>{label}</strong>
          <small>{sync.email}</small>
        </div>
        <button className="btn btn-soft press" disabled={sync.phase === 'syncing'} onClick={() => void syncNow({ manual: true })}><RefreshCw size={15} /> Sync now</button>
      </div>
      {sync.error && sync.error.code !== 'offline' && <p className="error">{sync.error.message}</p>}
      {sync.error?.code === 'offline' && <p className="note">{sync.error.message}</p>}
      {sync.tooLarge > 0 && <p className="note">{sync.tooLarge} {sync.tooLarge === 1 ? 'chat is' : 'chats are'} too big to sync and stay on this device.</p>}
      {sync.skipped > 0 && <p className="note">{sync.skipped} synced {sync.skipped === 1 ? 'chat' : 'chats'} couldn’t be read, so {sync.skipped === 1 ? 'it was' : 'they were'} skipped.</p>}

      {cloud && (
        <>
          <div className="sheet-section-title">Cloud storage</div>
          <div className="storage-box">
            <div className="progress" role="progressbar" aria-valuenow={percent(cloud.usedBytes, cloud.limitBytes)} aria-valuemin={0} aria-valuemax={100} aria-label="Cloud storage used">
              <div className="progress-fill" style={{ width: `${Math.max(1, percent(cloud.usedBytes, cloud.limitBytes))}%` }} />
            </div>
            <p className="note" style={{ margin: 0 }}>{formatBytes(cloud.usedBytes)} of {formatBytes(cloud.limitBytes)} · {cloud.records} {cloud.records === 1 ? 'chat' : 'chats'}</p>
          </div>
        </>
      )}

      <div className="sheet-section-title">On this device</div>
      <div className="storage-box">
        <p>Stop syncing here. Your chats stay on this device and in the cloud, and you can join again with your recovery key.</p>
        <button className="btn btn-soft press" onClick={() => void turnOff()}>Turn off on this device</button>
      </div>

      <div className="sheet-section-title">Delete</div>
      <div className="storage-box">
        <p>Remove the encrypted copy from Quo’s servers for good, on all your devices. Chats on your devices aren’t deleted.</p>
        {confirm
          ? (
            <div className="model-actions">
              <button className="btn btn-primary press" style={{ background: 'var(--error)' }} disabled={busy} onClick={() => void deleteAll()}>{busy ? 'Deleting…' : 'Yes, delete the cloud copy'}</button>
              <button className="btn btn-ghost press" disabled={busy} onClick={() => setConfirm(false)}>Cancel</button>
            </div>
          )
          : <button className="btn btn-ghost press" onClick={() => setConfirm(true)}>Delete the cloud copy…</button>}
      </div>
    </>
  );
}
