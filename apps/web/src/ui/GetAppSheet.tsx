import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppWindow, Check, Download, Laptop, Smartphone, X } from 'lucide-react';
import { installMethod, promptInstall, subscribeInstall } from '../install';
import {
  APP_STORE_URL, DESKTOP_DOWNLOADS, GITHUB_URL, PLAY_STORE_URL, desktopOS, isDesktopApp, openExternal, type DesktopOS,
} from '../platform';
import { toast } from './Toasts';

/** After a desktop download starts: what to do with the file. Unsigned builds need one extra step. */
export const AFTER_DOWNLOAD: Record<DesktopOS, string> = {
  mac: 'Open the downloaded file and drag Quo into Applications. If macOS says it can’t check the app, open System Settings › Privacy & Security and choose Open Anyway.',
  windows: 'Open the downloaded file to install Quo. If Windows shows “Windows protected your PC”, choose More info › Run anyway.',
  linux: 'Make the AppImage executable (chmod +x), then open it. On Ubuntu 22.04 or later, install libfuse2 first. A .deb is also on the releases page.',
};

export function useInstallMethod() {
  return useSyncExternalStore(subscribeInstall, () => installMethod());
}

/** Every way to get Quo: install from this browser, the desktop app, and the phone apps. */
export function GetAppSheet({ slowBrowser, onClose }: { slowBrowser: boolean; onClose: () => void }) {
  const sheet = useRef<HTMLDivElement>(null);
  const method = useInstallMethod();
  const os = desktopOS();
  const [started, setStarted] = useState<DesktopOS | null>(null);
  const inDesktop = isDesktopApp();

  useEffect(() => {
    sheet.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function install() {
    if (await promptInstall()) {
      toast('Quo is installed. Open it from your dock, taskbar or app launcher.');
      onClose();
    }
  }

  function download(target: DesktopOS) {
    window.location.href = DESKTOP_DOWNLOADS[target].url;
    setStarted(target);
  }

  const others = (Object.keys(DESKTOP_DOWNLOADS) as DesktopOS[]).filter(key => key !== os);

  return (
    <div className="scrim" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="sheet glass thick get-app" role="dialog" aria-modal="true" aria-labelledby="get-app-title" tabIndex={-1} ref={sheet}>
        <div className="sheet-head">
          <h2 id="get-app-title">Get Quo</h2>
          <button className="icon-btn round press" onClick={onClose} aria-label="Close"><X size={19} /></button>
        </div>
        <div className="sheet-body">
          {!inDesktop && (
            <>
              <div className="sheet-section-title">On this computer</div>

              {os && (
                <div className={`app-option${started === os ? ' done' : ''}`}>
                  <span className="app-option-icon"><Laptop size={20} /></span>
                  <span className="grow">
                    <strong>Quo for {DESKTOP_DOWNLOADS[os].label} <span className="badge">Recommended</span></strong>
                    <span>{slowBrowser ? 'Uses your graphics card, so replies are much faster than in this browser.' : 'Quo as an app on your computer. Runs on your graphics card and opens from your dock or taskbar.'}</span>
                  </span>
                  <button className="btn btn-primary press" onClick={() => download(os)}>
                    {started === os ? <><Check size={16} /> Downloading</> : <><Download size={16} /> Download</>}
                  </button>
                </div>
              )}
              {started && <p className="after-download">{AFTER_DOWNLOAD[started]}</p>}

              {method === 'prompt' && (
                <div className="app-option">
                  <span className="app-option-icon"><AppWindow size={20} /></span>
                  <span className="grow">
                    <strong>Install from this browser</strong>
                    <span>One click, nothing to download. Opens in its own window and works offline.</span>
                  </span>
                  <button className="btn btn-soft press" onClick={() => void install()}>Install</button>
                </div>
              )}
              {method === 'safari-dock' && (
                <div className="app-option">
                  <span className="app-option-icon"><AppWindow size={20} /></span>
                  <span className="grow">
                    <strong>Add to your Dock</strong>
                    <span>In Safari’s menu bar, choose File › Add to Dock. Quo then opens like an app.</span>
                  </span>
                </div>
              )}

              <p className="note other-os">
                {os ? 'Also for ' : 'Desktop app for '}
                {others.map((key, index) => (
                  <span key={key}>
                    {index > 0 && (index === others.length - 1 ? ' and ' : ', ')}
                    <button className="btn-link" onClick={() => download(key)}>{DESKTOP_DOWNLOADS[key].label}</button>
                  </span>
                ))}
                .
              </p>
            </>
          )}

          <div className="sheet-section-title">On your phone</div>
          <div className="app-option">
            <span className="app-option-icon"><Smartphone size={20} /></span>
            <span className="grow">
              <strong>iPhone and Android</strong>
              <span>The full app: documents, photos and voice, all on your phone.</span>
            </span>
            <div className="store-buttons">
              {APP_STORE_URL
                ? <button className="btn btn-soft press" onClick={() => openExternal(APP_STORE_URL!)}>App Store</button>
                : <span className="note">iPhone soon</span>}
              <button className="btn btn-soft press" onClick={() => openExternal(PLAY_STORE_URL)}>Google Play</button>
            </div>
          </div>

          <p className="note sheet-foot">
            Quo is free and open source. <button className="btn-link" onClick={() => openExternal(GITHUB_URL)}>See the code on GitHub</button>
          </p>
        </div>
      </div>
    </div>
  );
}
