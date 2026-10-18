import { Cloud, Crown, Download, Lock, Pause, WifiOff, Zap } from 'lucide-react';
import { getLocalModel, modelSizeBytes } from '../catalog';
import type { Account } from '../cloud/account';
import type { CloudCatalog, CloudModel } from '../cloud/catalog';
import { frontierModels } from '../cloud/pro';
import { recommendedModelId, type DeviceProfile } from '../device';
import { isDesktopApp } from '../platform';
import { cancelDownload, startDownload, type DownloadState } from '../storage/downloads';
import { downloadErrorText, formatBytes, percent } from './format';
import { QuoMark } from './QuoMark';

/**
 * First run: one action. Download the model that suits this computer; it
 * stays on the device and works offline from then on. While it downloads,
 * the free cloud model is offered as an explicit, clearly labelled opt-in.
 */
export function Welcome({ device, downloads, onBrowseModels, cloudModel, onUseCloud, catalog, account, onOpenPro }: {
  device: DeviceProfile | null;
  downloads: Record<string, DownloadState>;
  onBrowseModels: () => void;
  /** The free cloud model, when Quo's API is reachable. */
  cloudModel: CloudModel | null;
  onUseCloud: () => void;
  /** For the Quo Pro teaser: the cloud models, and whether this person is on Pro already. */
  catalog: CloudCatalog | null;
  account: Account | null;
  onOpenPro: () => void;
}) {
  const frontier = frontierModels(catalog);
  const showPro = Boolean(account) && account!.plan !== 'pro' && frontier.length > 0;
  const model = getLocalModel(device ? recommendedModelId(device) : 'qwen35-0.8b')!;
  // A download already running for any model takes precedence.
  const running = Object.entries(downloads).find(([, s]) => ['downloading', 'waiting', 'verifying', 'moving'].includes(s.status));
  const target = running ? getLocalModel(running[0]) ?? model : model;
  const state = downloads[target.id];
  const status = state?.status ?? 'idle';
  const total = state?.total || modelSizeBytes(target);
  const pct = percent(state?.loaded ?? 0, total);
  const busy = Boolean(running);

  return (
    <section className="welcome">
      <div className="welcome-card glass">
        <QuoMark />
        <h1>{isDesktopApp() ? 'Private AI, right on your computer.' : 'Private AI, right in your browser.'}</h1>
        <p className="lede">Download a model once. It runs on this computer, works offline, and nothing you type ever leaves it.</p>

        {busy ? (
          <div className="welcome-progress">
            <div className="welcome-progress-head">
              <span>{status === 'waiting' ? 'Waiting for connection…' : status === 'verifying' ? 'Checking file…' : status === 'moving' ? 'Saving to your folder…' : `Downloading ${target.name}`}</span>
              <span>{formatBytes(state?.loaded ?? 0)} of {formatBytes(total)}</span>
            </div>
            <div className="progress lg" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Model download">
              <div className="progress-fill" style={{ width: `${pct}%` }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
              <p className="note" style={{ margin: 0, flex: 1 }}>{isDesktopApp() ? 'Quit the app' : 'Close the tab'} or go offline anytime. It picks up where it left off.</p>
              {(status === 'downloading' || status === 'waiting') && (
                <button className="btn btn-soft press" onClick={() => cancelDownload(target.id)}><Pause size={15} /> Pause</button>
              )}
            </div>
            {cloudModel && (
              <div className="welcome-cloud">
                <button className="btn btn-glass press" onClick={onUseCloud}><Cloud size={16} /> Chat in the cloud while you wait</button>
                <p className="note">Free with {cloudModel.name}. Those messages are sent to {cloudModel.provider} to answer, and Quo doesn’t store them. Quo switches to your offline model when it’s ready.</p>
              </div>
            )}
          </div>
        ) : (
          <>
            <button className="btn btn-primary btn-lg press" onClick={() => void startDownload(target)}>
              <Download size={19} />
              {status === 'partial' ? `Resume ${target.name} · ${pct}%` : `Download ${target.name}`}
            </button>
            <p className="note">
              {formatBytes(total)} · free, no account · <button className="btn-link" onClick={onBrowseModels}>other models</button>
            </p>
            {status === 'error' && <p className="error">{downloadErrorText(state?.error)}</p>}
          </>
        )}

        <ul className="welcome-steps">
          <li><Lock size={14} /> Stays on this device</li>
          <li><WifiOff size={14} /> Works offline</li>
          <li><Zap size={14} /> {device?.gpu ? 'Uses your graphics card' : 'Runs on your processor'}</li>
        </ul>

        {showPro && (
          <div className="welcome-pro">
            <div className="welcome-pro-head"><Crown size={15} /> Want even smarter answers?</div>
            <p>Quo Pro adds the frontier models in the cloud, always your choice and always labelled. Your offline models stay free.</p>
            <div className="chips">
              {frontier.slice(0, 4).map(model => <span key={model.id} className="chip"><Lock size={11} /> {model.name}</span>)}
              {frontier.length > 4 && <span className="chip more">+{frontier.length - 4} more</span>}
            </div>
            <button className="btn-link" onClick={onOpenPro}>See what’s in Quo Pro</button>
          </div>
        )}
      </div>
    </section>
  );
}
