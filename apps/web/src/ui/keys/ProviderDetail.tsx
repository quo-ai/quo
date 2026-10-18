import { useState, type FormEvent } from 'react';
import { ArrowLeft, ExternalLink, Pencil } from 'lucide-react';
import { disconnectProvider, type ProviderAccount } from '../../providers/accounts';
import { connectAndCheck } from '../../providers/connect';
import { listProviderModels, type ListedModel } from '../../providers/listing';
import { removeProviderModels } from '../../providers/ownModels';
import { toast } from '../Toasts';
import { CustomForm } from './CustomForm';
import { ProviderModels } from './ProviderModels';

interface ProviderDetailProps {
  account: ProviderAccount;
  selectedKey: string | null;
  onBack: () => void;
  onUse: (key: string) => void;
}

const reason = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong. Try again.');

/** One provider: its key, and the models you use from it. */
export function ProviderDetail({ account, selectedKey, onBack, onUse }: ProviderDetailProps) {
  const { info } = account;
  const [draft, setDraft] = useState('');
  const [replacing, setReplacing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listed, setListed] = useState<ListedModel[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const ready = account.configured || Boolean(info.custom);

  async function loadModels() {
    setLoading(true);
    setProblem(null);
    try {
      setListed(await listProviderModels(info));
    } catch (failure) {
      setProblem(reason(failure));
    } finally {
      setLoading(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setListed(await connectAndCheck(info, draft));
      setDraft('');
      setReplacing(false);
      toast(`${info.name} is connected`);
    } catch (failure) {
      setError(reason(failure));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    try {
      await disconnectProvider(info.id);
      removeProviderModels(info.id);
      setListed(null);
      toast(`Removed your ${info.name} key`);
    } catch (failure) {
      setError(reason(failure));
    }
  }

  return (
    <>
      <div className="keys-head">
        <button type="button" className="icon-btn round press" onClick={onBack} aria-label="Back to all providers"><ArrowLeft size={18} /></button>
        <h3>{info.name}</h3>
        {info.custom && !editing && <button type="button" className="icon-btn round press" onClick={() => setEditing(true)} aria-label="Edit this server" title="Edit this server"><Pencil size={16} /></button>}
      </div>

      {editing ? (
        <CustomForm existing={info} onSaved={() => { setEditing(false); setListed(null); }} onRemoved={onBack} onCancel={() => setEditing(false)} />
      ) : (
        <>
          {info.custom && <p className="note keys-url">{info.baseUrl} · {info.protocol === 'anthropic' ? 'Anthropic-style' : 'OpenAI-style'}</p>}
          {account.configured && !replacing ? (
            <div className="keys-saved">
              <span className="grow"><span className="title">Key saved</span><span className="sub">•••• {account.last4}</span></span>
              <button type="button" className="btn btn-soft press small" onClick={() => setReplacing(true)}>Replace</button>
              <button type="button" className="btn btn-soft press small" onClick={() => void remove()}>Remove</button>
            </div>
          ) : (
            <form className="keys-form" onSubmit={event => void save(event)}>
              {!info.custom && (
                <p className="note">
                  Paste your {info.name} API key.{' '}
                  {info.keyUrl && <a className="btn-link" href={info.keyUrl} target="_blank" rel="noreferrer noopener">Get a key <ExternalLink size={12} /></a>}
                </p>
              )}
              <span className="field-wrap"><input className="field" type="password" value={draft} onChange={e => setDraft(e.target.value)} placeholder={info.custom ? 'Key (if the server needs one)' : 'Paste key'} autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} aria-label={`${info.name} API key`} /></span>
              {error && <p className="error" role="alert">{error}</p>}
              <div className="keys-actions">
                <button className="btn btn-primary press" type="submit" disabled={busy || draft.trim().length < 8}>{busy ? 'Checking…' : 'Save key'}</button>
                {replacing && <button className="btn btn-soft press" type="button" onClick={() => { setReplacing(false); setDraft(''); setError(null); }}>Cancel</button>}
              </div>
            </form>
          )}
          {ready && <ProviderModels provider={info} listed={listed} loading={loading} problem={problem} selectedKey={selectedKey} onLoad={() => void loadModels()} onUse={onUse} />}
        </>
      )}
    </>
  );
}
