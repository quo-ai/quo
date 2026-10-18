import { CheckCircle2, Download, Eye, FolderClosed, Pause, Play, Trash2 } from 'lucide-react';
import { allLocalModels, modelSizeBytes, type LocalModel } from '../catalog';
import { forgetCustomModel, useCustomModels } from '../customModels';
import { modelFit, recommendedModelId, type DeviceProfile } from '../device';
import { cancelDownload, removeModel, startDownload, type DownloadState } from '../storage/downloads';
import { downloadErrorText, formatBytes, percent } from './format';

interface ModelListProps {
  device: DeviceProfile | null;
  downloads: Record<string, DownloadState>;
  activeModelId: string | null;
  onUse: (model: LocalModel) => void;
}

const FIT_NOTE = {
  good: null,
  slow: 'May be slow on this computer.',
  'too-big': 'Likely too large for this computer’s memory.',
} as const;

export function ModelList({ device, downloads, activeModelId, onUse }: ModelListProps) {
  useCustomModels(); // re-render when models are added or forgotten
  const recommended = device ? recommendedModelId(device) : null;
  return (
    <div>
      {allLocalModels().map(model => (
        <ModelCard
          key={model.id}
          model={model}
          state={downloads[model.id]}
          active={model.id === activeModelId}
          recommended={model.id === recommended}
          fitNote={device ? FIT_NOTE[modelFit(model, device)] : null}
          onUse={() => onUse(model)}
        />
      ))}
    </div>
  );
}

function ModelCard({ model, state, active, recommended, fitNote, onUse }: {
  model: LocalModel;
  state?: DownloadState;
  active: boolean;
  recommended: boolean;
  fitNote: string | null;
  onUse: () => void;
}) {
  const status = state?.status ?? 'idle';
  const total = state?.total || modelSizeBytes(model);
  const pct = percent(state?.loaded ?? 0, total);
  const busy = status === 'downloading' || status === 'waiting' || status === 'verifying' || status === 'moving';

  return (
    <div className={`model-card${active ? ' active' : ''}`}>
      <div className="model-head">
        <span className="model-name">{model.name}</span>
        {recommended && <span className="badge">Recommended</span>}
        {model.vision && <span className="badge" title="Can read photos and screenshots"><Eye size={11} /> Reads images</span>}
        {active && <span className="badge green"><CheckCircle2 size={12} /> In use</span>}
        <span className="model-size">{formatBytes(total)}</span>
      </div>
      <p className="model-desc">{model.description}</p>
      {fitNote && status !== 'installed' && <p className="model-meta warn">{fitNote}</p>}
      {status === 'installed' && state?.location === 'folder' && (
        <p className="model-meta muted"><FolderClosed size={12} /> In your models folder</p>
      )}

      {busy && (
        <>
          <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${model.name} download`}>
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <p className="model-meta muted">
            {status === 'waiting' ? `Waiting for connection · ${pct}%`
              : status === 'verifying' ? 'Checking file…'
                : status === 'moving' ? 'Saving to your folder…'
                  : `${formatBytes(state?.loaded ?? 0)} of ${formatBytes(total)} · ${pct}%`}
          </p>
        </>
      )}

      <div className="model-actions">
        {status === 'installed' && !active && (
          <button className="btn btn-primary press" onClick={onUse}>Use this model</button>
        )}
        {status === 'installed' && (
          <button
            className="btn btn-ghost press"
            onClick={() => void (model.custom ? forgetCustomModel(model.id) : removeModel(model))}
            title={model.custom ? 'Stops using it in Quo; the file stays where it is' : undefined}
          >
            <Trash2 size={15} /> {model.custom ? 'Forget' : 'Remove'}
          </button>
        )}
        {(status === 'idle' || status === 'error') && (
          <button className="btn btn-primary press" onClick={() => void startDownload(model)}><Download size={16} /> Download</button>
        )}
        {status === 'partial' && (
          <button className="btn btn-primary press" onClick={() => void startDownload(model)}><Play size={15} /> Resume · {pct}%</button>
        )}
        {(status === 'downloading' || status === 'waiting') && (
          <button className="btn btn-soft press" onClick={() => cancelDownload(model.id)}><Pause size={15} /> Pause</button>
        )}
      </div>
      {status === 'error' && <p className="error">{downloadErrorText(state?.error)}</p>}
    </div>
  );
}
