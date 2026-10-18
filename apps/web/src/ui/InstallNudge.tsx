import { useEffect, useState } from 'react';
import { AppWindow, Laptop, X } from 'lucide-react';
import { promptInstall } from '../install';
import { DESKTOP_DOWNLOADS, desktopOS } from '../platform';
import { AFTER_DOWNLOAD, useInstallMethod } from './GetAppSheet';
import { toast } from './Toasts';

const KEY = 'quo.installNudge';
const REST_DAYS = 14;
const MAX_DISMISSALS = 2;

interface NudgeRecord {
  dismissedAt?: number;
  dismissals?: number;
  done?: boolean;
}

function readRecord(): NudgeRecord {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as NudgeRecord;
  } catch {
    return {};
  }
}

const writeRecord = (record: NudgeRecord) => localStorage.setItem(KEY, JSON.stringify(record));

/** Not after installing, not twice in two weeks, and never after two "Not now"s. */
export function nudgeAllowed(now = Date.now(), record = readRecord()): boolean {
  if (record.done || (record.dismissals ?? 0) >= MAX_DISMISSALS) return false;
  return !record.dismissedAt || now - record.dismissedAt > REST_DAYS * 86_400_000;
}

/**
 * A one-time card, shown once Quo has answered on this computer: install it
 * from the browser in one click (Chrome / Edge), or, where the browser can't
 * install apps (Firefox, Safari), get the desktop app.
 */
export function InstallNudge({ slowBrowser, onMore }: { slowBrowser: boolean; onMore: () => void }) {
  const method = useInstallMethod();
  const os = desktopOS();
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [downloaded, setDownloaded] = useState(false);

  // A beat after the reply, so it never interrupts reading.
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 2500);
    return () => clearTimeout(timer);
  }, []);

  const browserInstall = method === 'prompt';
  if (!visible || (!browserInstall && !os)) return null;

  function close(record: NudgeRecord) {
    writeRecord(record);
    setLeaving(true);
    setTimeout(() => setVisible(false), 220);
  }

  function notNow() {
    const record = readRecord();
    close({ ...record, dismissedAt: Date.now(), dismissals: (record.dismissals ?? 0) + 1 });
  }

  async function install() {
    if (await promptInstall()) {
      toast('Quo is installed. Open it from your dock, taskbar or app launcher.');
      close({ done: true });
    }
  }

  function download() {
    if (!os) return;
    window.location.href = DESKTOP_DOWNLOADS[os].url;
    writeRecord({ done: true });
    setDownloaded(true);
  }

  return (
    <aside className={`install-nudge glass thick${leaving ? ' leaving' : ''}`} aria-labelledby="install-nudge-title">
      <button className="icon-btn round press nudge-x" onClick={notNow} aria-label="Not now"><X size={16} /></button>
      <span className="nudge-icon">{browserInstall ? <AppWindow size={22} /> : <Laptop size={22} />}</span>
      {downloaded && os ? (
        <>
          <h3 id="install-nudge-title">Your download has started</h3>
          <p>{AFTER_DOWNLOAD[os]}</p>
          <div className="nudge-actions">
            <button className="btn btn-soft press" onClick={() => close({ done: true })}>Done</button>
          </div>
        </>
      ) : browserInstall ? (
        <>
          <h3 id="install-nudge-title">Install Quo on this computer</h3>
          <p>Open it from your dock or taskbar, in its own window. Works offline, nothing extra to download.</p>
          <div className="nudge-actions">
            <button className="btn btn-primary press" onClick={() => void install()}>Install</button>
            <button className="btn btn-ghost press" onClick={notNow}>Not now</button>
          </div>
        </>
      ) : (
        <>
          <h3 id="install-nudge-title">Get Quo for {DESKTOP_DOWNLOADS[os!].label}</h3>
          <p>{slowBrowser
            ? 'The desktop app uses your graphics card, so replies are much faster than in this browser.'
            : 'Quo as an app on your computer. Opens from your dock or taskbar and works offline.'}</p>
          <div className="nudge-actions">
            <button className="btn btn-primary press" onClick={download}>Download</button>
            <button className="btn btn-ghost press" onClick={notNow}>Not now</button>
          </div>
          <button className="btn-link nudge-more" onClick={onMore}>Other ways to get Quo</button>
        </>
      )}
    </aside>
  );
}
