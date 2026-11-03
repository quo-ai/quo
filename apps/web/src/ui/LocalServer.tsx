import { useEffect, useState } from 'react';
import { Copy, KeyRound } from 'lucide-react';
import { NativeError, unwrap, type LocalServerState, type NativeResult } from '../native';
import { toast } from './Toasts';

const bridge = () => (typeof window === 'undefined' ? null : window.quoDesktop?.localServer ?? null);
export const hasLocalServer = (): boolean => bridge() !== null;

/**
 * Desktop app: a server other apps on this computer can use (editors, scripts, tools that speak the OpenAI API), answered
 * by the model Quo has loaded. Off until turned on, which the desktop app asks about in its own window.
 */
export function LocalServer() {
  const [state, setState] = useState<LocalServerState | null>(null);
  useEffect(() => { void bridge()?.state().then(result => setState(unwrap(result))).catch(() => {}); }, []);
  const run = async (task: () => Promise<NativeResult<LocalServerState>>) => {
    try {
      setState(unwrap(await task()));
    } catch (error) {
      toast(error instanceof NativeError ? error.message : 'That didn’t work.');
    }
  };
  const copy = (text: string, what: string) => void navigator.clipboard.writeText(text).then(() => toast(`${what} copied`));
  const server = bridge();
  if (!server || !state) return null;
  return (
    <div className="storage-box">
      <p>Let other apps on this computer use the offline model Quo has loaded: code editors, scripts and tools that speak the OpenAI API. Only apps on this computer that have the key can use it; web pages and other computers can’t.</p>
      <label className="hf-check">
        <input type="checkbox" checked={state.on} onChange={event => void run(() => server.set(event.target.checked))} />
        Local server for other apps
      </label>
      {state.on && (
        <>
          <div className="field-row">
            <span>Address</span>
            <button type="button" className="btn btn-glass press small" onClick={() => copy(state.address, 'Address')}><Copy size={14} /> {state.address}</button>
          </div>
          <div className="field-row">
            <span>API key</span>
            <span className="model-actions">
              <button type="button" className="btn btn-glass press small" onClick={() => copy(state.key, 'Key')}><Copy size={14} /> Copy key</button>
              <button type="button" className="btn btn-ghost press small" onClick={() => void run(() => server.renewKey())} title="Apps using the old key stop working until they get the new one"><KeyRound size={14} /> New key</button>
            </span>
          </div>
          <p className="note">It answers GET /v1/models and POST /v1/chat/completions and /v1/completions with the model loaded in Quo. Start a chat with an offline model first.</p>
        </>
      )}
    </div>
  );
}
