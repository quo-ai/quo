import { useEffect, useState } from 'react';
import { FolderOpen, HardDrive, ShieldCheck } from 'lucide-react';
import { folderPermission, folderSupported, getSavedFolder } from '../storage/folder';
import { reconnectModelsFolder, stopUsingModelsFolder, useModelsFolder } from '../storage/downloads';
import { toast } from './Toasts';

type FolderState = 'none' | 'connected' | 'needs-permission';

/**
 * Where models are kept. Chromium can keep them in a folder on the computer
 * (survives clearing site data); elsewhere they live in browser storage.
 */
export function StorageSettings({ persisted }: { persisted: boolean | null }) {
  const [folder, setFolder] = useState<{ state: FolderState; name?: string }>({ state: 'none' });
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const handle = await getSavedFolder();
    if (!handle) return setFolder({ state: 'none' });
    const permission = await folderPermission(handle);
    setFolder({ state: permission === 'granted' ? 'connected' : 'needs-permission', name: handle.name });
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function run(action: () => Promise<unknown>, done?: string) {
    setBusy(true);
    try {
      const result = await action();
      if (done && result !== false) toast(done);
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  const browserNote = (
    <p>
      <ShieldCheck size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
      Models are stored in this browser{persisted ? ' and protected from automatic clean-up' : ''}. They work offline.
    </p>
  );

  if (!folderSupported) {
    return (
      <div className="storage-box">
        {browserNote}
        <p>Clearing this site’s data in your browser settings removes them. Install Quo as an app to keep them safest.</p>
      </div>
    );
  }

  if (folder.state === 'connected') {
    return (
      <div className="storage-box">
        <p><FolderOpen size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
          Models are saved in your <strong>{folder.name}</strong> folder, so they’re kept even if you clear this site’s data.</p>
        <button className="btn btn-ghost press" disabled={busy} onClick={() => void run(stopUsingModelsFolder, 'Stopped using the folder')}>Stop using folder</button>
      </div>
    );
  }

  if (folder.state === 'needs-permission') {
    return (
      <div className="storage-box">
        <p>Quo needs your permission again to use the <strong>{folder.name}</strong> folder.</p>
        <button className="btn btn-primary press" disabled={busy} onClick={() => void run(reconnectModelsFolder, 'Folder reconnected')}>Reconnect folder</button>
      </div>
    );
  }

  return (
    <div className="storage-box">
      {browserNote}
      <p><HardDrive size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
        For extra safety, keep models as files in a folder on this computer. They’ll stay even if browser data is cleared.</p>
      <button className="btn btn-soft press" disabled={busy} onClick={() => void run(useModelsFolder, 'Models saved to your folder')}>
        {busy ? 'Saving models…' : 'Choose a folder'}
      </button>
    </div>
  );
}
