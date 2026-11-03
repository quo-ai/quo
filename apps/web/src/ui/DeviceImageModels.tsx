import { Download, Pause, Play, Trash2 } from 'lucide-react';
import { engineMemoryGB, type DeviceProfile } from '../device';
import { DEVICE_IMAGE_MODELS, imageModelBytes, type ImageModel } from '../images/deviceModels';
import { cancelDownload, removeDeviceModel, startDeviceDownload, type DownloadState } from '../storage/downloads';
import { setImagePrefs, useImagePrefs } from '../images/prefs';
import { Facts } from './Facts';
import { downloadErrorText, formatBytes, percent } from './format';

/**
 * Desktop app: image models that run on this computer (images/deviceModels.ts). With one downloaded, offline chats make
 * their images here instead of in Quo's cloud, so nothing about them leaves the computer.
 */
export function DeviceImageModels({ device, downloads }: { device: DeviceProfile | null; downloads: Record<string, DownloadState> }) {
  const memory = device ? engineMemoryGB(device) : null;
  const prefs = useImagePrefs();
  return (
    <div className="storage-box">
      <p>Make images on this computer. With an image model downloaded, offline chats make their pictures here: nothing is sent anywhere, and there are no credits or limits.</p>
      {DEVICE_IMAGE_MODELS.map(model => <ImageModelCard key={model.id} model={model} state={downloads[model.id]} slow={memory !== null && memory < model.minMemoryGB} gpu={Boolean(device?.gpu)} />)}
      <label className="hf-check">
        <input type="checkbox" checked={prefs.everyOnDevice} onChange={event => setImagePrefs({ everyOnDevice: event.target.checked })} />
        Make every image on this computer, cloud chats too (when an image model is downloaded)
      </label>
      {prefs.offlineCloud === 'allow' && (
        <p className="note">Offline chats without an image model make their pictures in the cloud without asking. <button className="btn-link" onClick={() => setImagePrefs({ offlineCloud: 'ask' })}>Ask again</button></p>
      )}
    </div>
  );
}

function ImageModelCard({ model, state, slow, gpu }: { model: ImageModel; state?: DownloadState; slow: boolean; gpu: boolean }) {
  const status = state?.status ?? 'idle';
  const total = state?.total || imageModelBytes(model);
  const pct = percent(state?.loaded ?? 0, total);
  const busy = status === 'downloading' || status === 'waiting' || status === 'verifying';
  const note = !gpu
    ? 'Quo didn’t find a graphics card it can use, so each image would take minutes.'
    : slow ? `Works best with ${model.minMemoryGB} GB of graphics memory; on this computer images take longer.` : null;
  return (
    <div className="model-card">
      <div className="model-head">
        <span className="model-name">{model.name}</span>
        <span className="model-size">{formatBytes(total)}</span>
      </div>
      <p className="model-desc">{model.description}</p>
      <p className="model-meta muted"><Facts items={[`By ${model.maker}`, model.licence]} /></p>
      {note && status !== 'installed' && <p className="model-meta warn">{note}</p>}
      {status === 'installed' && <p className="model-meta muted">Ready: offline chats make images with it. Ask for a picture, or type /image.</p>}
      {busy && (
        <>
          <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${model.name} download`}>
            <div className="progress-fill working" style={{ width: `${pct}%` }} />
          </div>
          <p className="model-meta muted">
            {status === 'waiting' ? `Waiting for connection, ${pct}%` : status === 'verifying' ? 'Checking files…' : `${formatBytes(state?.loaded ?? 0)} of ${formatBytes(total)} (${pct}%)`}
          </p>
        </>
      )}
      <div className="model-actions">
        {status === 'installed' && <button className="btn btn-ghost press" onClick={() => void removeDeviceModel(model)}><Trash2 size={15} /> Remove</button>}
        {(status === 'idle' || status === 'error') && <button className="btn btn-glass press" onClick={() => void startDeviceDownload(model)}><Download size={16} /> Download</button>}
        {status === 'partial' && <button className="btn btn-glass press" onClick={() => void startDeviceDownload(model)}><Play size={15} /> Resume at {pct}%</button>}
        {(status === 'downloading' || status === 'waiting') && <button className="btn btn-soft press" onClick={() => cancelDownload(model.id)}><Pause size={15} /> Pause</button>}
      </div>
      {status === 'error' && <p className="error">{downloadErrorText(state?.error)}</p>}
    </div>
  );
}
