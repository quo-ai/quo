import { useState } from 'react';
import { Cpu, Laptop, Link2, Smartphone, X } from 'lucide-react';
import type { DeviceNotice } from '../device';
import { isDesktopApp, mobileStoreUrl, openExternal } from '../platform';
import { toast } from './Toasts';

const DISMISSED_KEY = 'quo.dismissedNotice';

export function isNoticeDismissed(notice: DeviceNotice): boolean {
  return localStorage.getItem(DISMISSED_KEY) === notice.id;
}

/** Top-of-screen notice explaining why replies may be slow here, and what helps. */
export function DeviceBanner({ notice, onDismiss, onGetApp }: { notice: DeviceNotice; onDismiss: () => void; onGetApp: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const switchBrowser = notice.id === 'firefox' || notice.id === 'safari';
  const mobile = notice.id === 'mobile';

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, notice.id);
    setLeaving(true);
    setTimeout(onDismiss, 220);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(location.origin);
      toast('Link copied. Paste it into Chrome or Edge.');
    } catch {
      toast(location.origin);
    }
  }

  function getMobileApp() {
    const store = mobileStoreUrl();
    if (store) openExternal(store);
    else onGetApp();
  }

  return (
    <div className={`device-banner glass thick${leaving ? ' leaving' : ''}`} role="status">
      {mobile ? <Smartphone size={18} /> : <Cpu size={18} />}
      <p>{notice.message}</p>
      {switchBrowser && !isDesktopApp() && (
        <>
          <button className="btn btn-primary press" onClick={onGetApp}><Laptop size={15} /> Desktop app</button>
          <button className="btn btn-soft press secondary" onClick={() => void copyLink()}><Link2 size={15} /> Copy link</button>
        </>
      )}
      {mobile && <button className="btn btn-primary press" onClick={getMobileApp}>Get the app</button>}
      <button className="icon-btn round press" onClick={dismiss} aria-label="Dismiss"><X size={17} /></button>
    </div>
  );
}
