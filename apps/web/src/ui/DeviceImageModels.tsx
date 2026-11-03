import { useEffect } from 'react';
import { CheckCircle2, Download, FilePlus2, Pause, Play, Trash2 } from 'lucide-react';
import { addOwnImageModel, canAddImageModels, refreshOwnImageModels, removeOwnImageModel, useOwnImageModels } from '../images/ownModels';
import { NativeError } from '../native';
import { toast } from './Toasts';
import { engineMemoryGB, type DeviceProfile } from '../device';
import { DEVICE_IMAGE_MODELS, imageModelBytes, suggestedImageModel, type ImageModel } from '../images/deviceModels';
import { deviceImageModel } from '../images/device';
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
  const suggested = suggestedImageModel(memory);
  const own = useOwnImageModels();
  useEffect(() => void refreshOwnImageModels().catch(() => {}), []);
  const installed = [...DEVICE_IMAGE_MODELS.filter(model => downloads[model.id]?.status === 'installed'), ...own];
  const inUse = installed.length > 1 ? deviceImageModel()?.id ?? null : null;
  return (
    <div className="storage-box">
      <p>Make images on this computer. With an image model downloaded, offline chats make their pictures here: nothing is sent anywhere, and there are no credits or limits.</p>
      {DEVICE_IMAGE_MODELS.map(model => <ImageModelCard key={model.id} model={model} state={downloads[model.id]} slow={memory !== null && memory < model.minMemoryGB} gpu={Boolean(device?.gpu)} recommended={model.id === suggested.id && installed.length === 0} inUse={inUse} />)}
      <div className="field-row">
        <span>Picture size</span>
        <div className="segmented" role="radiogroup" aria-label="Picture size">
          <button type="button" role="radio" aria-checked={prefs.size === 'standard'} aria-selected={prefs.size === 'standard'} onClick={() => setImagePrefs({ size: 'standard' })} title="About a megapixel: the sharpest">Standard</button>
          <button type="button" role="radio" aria-checked={prefs.size === 'quick'} aria-selected={prefs.size === 'quick'} onClick={() => setImagePrefs({ size: 'quick' })} title="About half the pixels: roughly a third faster">Quicker</button>
        </div>
      </div>
      {canAddImageModels() && (
        <>
          {own.map(model => (
            <div key={model.id} className="model-card">
              <div className="model-head">
                <span className="model-name">{model.name}</span>
                {inUse === model.id && <span className="badge green"><CheckCircle2 size={12} /> In use</span>}
              </div>
              <p className="model-meta muted"><Facts items={[model.licence, 'From your computer', model.edits ? 'Changes pictures' : null]} /></p>
              {'needs' in model && model.needs ? <p className="model-meta muted">Uses the text model and decoder of {String(model.needs)}: keep it downloaded.</p> : null}
              <div className="model-actions">
                {inUse !== null && inUse !== model.id && <button className="btn btn-glass press" onClick={() => setImagePrefs({ model: model.id })}>Use this model</button>}
                <button className="btn btn-ghost press" onClick={() => void removeOwnImageModel(model.id)} title="Quo stops using it; the file stays where it is"><Trash2 size={15} /> Forget</button>
              </div>
            </div>
          ))}
          <button className="btn btn-glass press" onClick={() => void addOwnImageModel().then(added => added && toast(`Added ${added.name}`), error => toast(error instanceof NativeError ? error.message : 'That file couldn’t be added.'))}>
            <FilePlus2 size={15} /> Add an image model file…
          </button>
          <p className="note">An SDXL or Stable Diffusion 1.5 checkpoint, or a Z-Image or FLUX.2 klein 4B model, as .safetensors or .gguf. Quo checks what it is from inside the file and uses it where it is.</p>
        </>
      )}
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

function ImageModelCard({ model, state, slow, gpu, recommended, inUse }: { model: ImageModel; state?: DownloadState; slow: boolean; gpu: boolean; recommended: boolean; inUse: string | null }) {
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
        {recommended && <span className="badge">Recommended</span>}
        {inUse === model.id && <span className="badge green"><CheckCircle2 size={12} /> In use</span>}
        <span className="model-size">{formatBytes(total)}</span>
      </div>
      <p className="model-desc">{model.description}</p>
      <p className="model-meta muted"><Facts items={[`By ${model.maker}`, model.licence, model.edits ? 'Changes pictures on this computer' : null]} /></p>
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
        {status === 'installed' && inUse !== null && inUse !== model.id && <button className="btn btn-glass press" onClick={() => setImagePrefs({ model: model.id })}>Use this model</button>}
        {status === 'installed' && <button className="btn btn-ghost press" onClick={() => void removeDeviceModel(model)}><Trash2 size={15} /> Remove</button>}
        {(status === 'idle' || status === 'error') && <button className="btn btn-glass press" onClick={() => void startDeviceDownload(model)}><Download size={16} /> Download</button>}
        {status === 'partial' && <button className="btn btn-glass press" onClick={() => void startDeviceDownload(model)}><Play size={15} /> Resume at {pct}%</button>}
        {(status === 'downloading' || status === 'waiting') && <button className="btn btn-soft press" onClick={() => cancelDownload(model.id)}><Pause size={15} /> Pause</button>}
      </div>
      {status === 'error' && <p className="error">{downloadErrorText(state?.error)}</p>}
    </div>
  );
}
