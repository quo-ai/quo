import { useEffect, useState, type FormEvent } from 'react';
import { ChevronRight, ExternalLink } from 'lucide-react';
import { NativeError, unwrap, type DesktopWeb, type NativeResult, type WebBackendState, type WebState } from '../../native';

const AUTO: WebBackendState = { id: 'auto', name: 'Automatic', needsKey: false, needsUrl: false, keyUrl: null, configured: true, last4: null };
const AUTO_HINT = 'The first of these that is set up: a service with a key, then your SearXNG, then DuckDuckGo.';
const NOTES: Record<string, string> = {
  duckduckgo: 'Needs nothing. It reads DuckDuckGo’s results page, so it can stop working or ask for a CAPTCHA.',
  searxng: 'Your own or any public SearXNG, with its JSON format turned on. No key.',
};

const reason = (error: unknown) => (error instanceof NativeError ? error.message : error instanceof Error ? error.message : 'Something went wrong. Try again.');

/** Which service searches the web, and the keys or address each needs. Keys are saved by the desktop app and never shown again. */
export function SearchServices({ bridge }: { bridge: DesktopWeb }) {
  const [state, setState] = useState<WebState | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState<string | null>(null);
  const [trying, setTrying] = useState(false);

  useEffect(() => {
    void bridge.state().then(result => setState(unwrap(result))).catch(failure => setError(reason(failure)));
  }, [bridge]);

  async function apply(task: Promise<NativeResult<WebState>>) {
    try {
      setState(unwrap(await task));
      setError(null);
      setDraft('');
    } catch (failure) {
      setError(reason(failure));
    }
  }

  async function tryIt() {
    setTrying(true);
    setTried(null);
    try {
      const result = unwrap(await bridge.search('settings-test', 'Quo AI offline assistant', { count: 3 }));
      const first = result.text.split('\n').find(line => /^\d+\./.test(line));
      setTried(`It works${first ? `: ${first.replace(/^\d+\.\s*/, '')}` : '.'} (${(result.display as { backend?: string } | undefined)?.backend ?? 'search'})`);
    } catch (failure) {
      setTried(reason(failure));
    } finally {
      setTrying(false);
    }
  }

  if (!state) return error ? <p className="error" role="alert">{error}</p> : null;

  const submit = (event: FormEvent, backend: WebBackendState) => {
    event.preventDefault();
    void apply(backend.needsUrl ? bridge.configure({ searxngUrl: draft.trim() }) : bridge.setKey(backend.id, draft.trim()));
  };
  const status = (backend: WebBackendState) => (backend.needsKey ? (backend.configured ? `Key saved · •••• ${backend.last4}` : 'Needs a key') : backend.needsUrl ? (backend.configured ? state.searxngUrl : 'Needs an address') : 'Ready');

  return (
    <>
      <div className="sheet-section-title">Search service</div>
      {[AUTO, ...state.backends].map(backend => {
        const selected = state.backend === backend.id;
        const expanded = open === backend.id;
        return (
          <div className="svc" key={backend.id}>
            <div className="svc-row">
              <button type="button" role="radio" aria-checked={selected} className={`svc-radio${selected ? ' on' : ''}`} onClick={() => void apply(bridge.configure({ backend: backend.id }))} aria-label={`Use ${backend.name}`} title={`Use ${backend.name}`} />
              <button type="button" className="menu-item press" aria-expanded={expanded} onClick={() => { setOpen(expanded ? null : backend.id); setDraft(''); setError(null); }}>
                <span className="grow">
                  <span className="title">{backend.name}</span>
                  <span className="sub">{backend.id === 'auto' ? 'Recommended' : status(backend)}</span>
                </span>
                <ChevronRight size={16} className={`svc-chev${expanded ? ' open' : ''}`} color="var(--text-3)" />
              </button>
            </div>
            {expanded && (
              <div className="svc-body">
                {backend.id === 'auto' && <p className="note">{AUTO_HINT}</p>}
                {NOTES[backend.id] && <p className="note">{NOTES[backend.id]}</p>}
                {(backend.needsKey || backend.needsUrl) && (
                  <form className="keys-form" onSubmit={event => submit(event, backend)}>
                    {backend.needsKey && backend.configured && <p className="note">Key saved (•••• {backend.last4}). {state.secure ? 'It is kept encrypted by your system.' : 'It is kept only until you quit Quo.'} Paste another to replace it, or <button type="button" className="btn-link" onClick={() => void apply(bridge.clearKey(backend.id))}>remove it</button>.</p>}
                    <span className="field-wrap"><input className="field" type={backend.needsKey ? 'password' : 'text'} value={draft} onChange={e => setDraft(e.target.value)} placeholder={backend.needsKey ? 'Paste your key' : 'http://localhost:8080'} autoComplete="off" autoCapitalize="off" spellCheck={false} aria-label={backend.needsKey ? `${backend.name} key` : 'SearXNG address'} /></span>
                    <div className="keys-actions">
                      <button className="btn btn-primary press small" type="submit" disabled={draft.trim().length < 8}>Save</button>
                      {backend.keyUrl && <a className="btn-link" href={backend.keyUrl} target="_blank" rel="noreferrer noopener">Get a key <ExternalLink size={12} /></a>}
                      {backend.needsUrl && state.searxngUrl && <button type="button" className="btn-link muted" onClick={() => void apply(bridge.configure({ searxngUrl: null }))}>Remove the address</button>}
                    </div>
                  </form>
                )}
              </div>
            )}
          </div>
        );
      })}
      {error && <p className="error" role="alert">{error}</p>}
      <button type="button" className="btn btn-soft press keys-browse" onClick={() => void tryIt()} disabled={trying}>{trying ? 'Searching…' : 'Try a search'}</button>
      {tried && <p className="note" role="status">{tried}</p>}
    </>
  );
}
