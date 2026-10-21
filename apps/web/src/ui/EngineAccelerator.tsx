import { useEffect, useState } from 'react';
import { Gauge, Trash2 } from 'lucide-react';
import { nativeBridge, unwrap, type AcceleratorStatus, type NativeResult } from '../native';
import { formatBytes } from './format';

/** What the faster engine is doing, in a sentence. */
export function acceleratorNote(status: AcceleratorStatus): string {
  if (status.installed && status.failed) return 'The faster engine for your graphics card didn’t start, so Quo went back to the one it came with.';
  if (status.installed && status.active) return `Running on the faster engine for your NVIDIA graphics card (${status.label}).`;
  if (status.installed) return 'The faster engine for your NVIDIA graphics card is downloaded but turned off.';
  return `A faster engine for your NVIDIA graphics card reads long messages about 40% faster and writes about 10% faster. It comes from llama.cpp’s own releases and is checked before use (${formatBytes(status.bytes)}).`;
}

/**
 * Desktop app: the faster engine for an NVIDIA graphics card (desktop accelerators.js). Shown only where there is one for
 * this computer. The page can only ask: the app decides which build it is, and checks it before using it.
 */
export function EngineAccelerator() {
  const accelerator = nativeBridge()?.engine.accelerator;
  const [status, setStatus] = useState<AcceleratorStatus | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accelerator) return;
    void accelerator.status().then(result => setStatus(unwrap(result))).catch(() => {});
    return accelerator.onEvent(event => {
      if (event.type === 'progress') setProgress(event.total ? Math.floor((event.loaded / event.total) * 100) : 0);
      else {
        setProgress(null);
        if (event.type === 'done') setStatus(event.status);
        else if (event.code !== 'cancelled') setError(event.message);
      }
    });
  }, [accelerator]);

  if (!accelerator || !status?.available) return null;
  const act = (task: Promise<NativeResult<AcceleratorStatus>>) =>
    void task.then(result => setStatus(unwrap(result))).catch(() => setError('That didn’t work. Try again.'));

  return (
    <div className="accelerator">
      <p>
        <Gauge size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
        {acceleratorNote(status)}
      </p>
      {progress !== null && (
        <div className="progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Faster engine download">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
      )}
      {error && <p className="note" role="alert">{error}</p>}
      <div className="accelerator-actions">
        {progress !== null ? (
          <button className="btn btn-ghost press" onClick={() => void accelerator.cancel()}>Cancel</button>
        ) : !status.installed ? (
          <button className="btn btn-ghost press" onClick={() => { setError(null); setProgress(0); void accelerator.install(); }}>Download ({formatBytes(status.bytes)})</button>
        ) : (
          <>
            {(!status.active || status.failed) && <button className="btn btn-ghost press" onClick={() => act(accelerator.use(true))}>{status.failed ? 'Try it again' : 'Turn it on'}</button>}
            {status.active && <button className="btn btn-ghost press" onClick={() => act(accelerator.use(false))}>Turn it off</button>}
            <button className="btn-link" onClick={() => act(accelerator.remove())}><Trash2 size={13} style={{ verticalAlign: -2 }} /> Remove</button>
          </>
        )}
      </div>
    </div>
  );
}
