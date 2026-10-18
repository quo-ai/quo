import { useEffect, useState } from 'react';
import { FolderOpen, ShieldCheck } from 'lucide-react';
import { nativeBridge, unwrap } from '../native';

/** Desktop app: models are plain files in a folder on this computer. */
export function NativeStorage() {
  const [folder, setFolder] = useState<string | null>(null);

  useEffect(() => {
    void nativeBridge()?.engine.info().then(result => setFolder(unwrap(result).modelsDir)).catch(() => {});
  }, []);

  return (
    <div className="storage-box">
      <p>
        <ShieldCheck size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
        Models are saved on this computer{folder ? <> in <code className="path">{folder}</code></> : ''}. They work offline, and nothing is sent anywhere.
      </p>
      <button className="btn btn-ghost press" onClick={() => void nativeBridge()?.models.reveal()}><FolderOpen size={15} /> Open the folder</button>
    </div>
  );
}
