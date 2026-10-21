import { useEffect, useState } from 'react';
import { FolderOpen, ShieldCheck, Trash2 } from 'lucide-react';
import { nativeBridge, unwrap } from '../native';
import { findLeftovers, removeLeftovers, type LeftoverModel } from '../storage/retired';
import { EngineAccelerator } from './EngineAccelerator';
import { formatBytes } from './format';

/** Desktop app: models are plain files in a folder on this computer. */
export function NativeStorage() {
  const [folder, setFolder] = useState<string | null>(null);
  const [leftovers, setLeftovers] = useState<LeftoverModel[]>([]);

  useEffect(() => {
    const bridge = nativeBridge();
    void bridge?.engine.info().then(result => setFolder(unwrap(result).modelsDir)).catch(() => {});
    if (bridge) void findLeftovers(bridge.models).then(setLeftovers);
  }, []);

  return (
    <div className="storage-box">
      <p>
        <ShieldCheck size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
        Models are saved on this computer{folder ? <> in <code className="path">{folder}</code></> : ''}. They work offline, and nothing is sent anywhere.
      </p>
      {leftovers.length > 0 && (
        <p className="note">
          Quo no longer offers {leftovers.map(model => model.name).join(' and ')} (better models replaced {leftovers.length === 1 ? 'it' : 'them'}), but {leftovers.length === 1 ? 'it is' : 'they are'} still on this computer, using {formatBytes(leftovers.reduce((sum, model) => sum + model.bytes, 0))}.{' '}
          <button className="btn-link" onClick={() => { const bridge = nativeBridge(); if (bridge) void removeLeftovers(bridge.models, leftovers).then(setLeftovers); }}><Trash2 size={13} style={{ verticalAlign: -2 }} /> Remove {leftovers.length === 1 ? 'it' : 'them'}</button>
        </p>
      )}
      <button className="btn btn-ghost press" onClick={() => void nativeBridge()?.models.reveal()}><FolderOpen size={15} /> Open the folder</button>
      <EngineAccelerator />
    </div>
  );
}
