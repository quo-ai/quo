import { useState, type FormEvent } from 'react';
import { removeCustomProvider, saveCustomProvider } from '../../providers/accounts';
import type { ProviderInfo, Protocol } from '../../providers/registry';
import { removeProviderModels } from '../../providers/ownModels';
import { toast } from '../Toasts';

interface CustomFormProps {
  /** The server being edited, or none to add one. */
  existing?: ProviderInfo;
  onSaved: (provider: ProviderInfo) => void;
  onRemoved: () => void;
  onCancel: () => void;
}

/** Add or edit a server of your own: Ollama or LM Studio on this computer, a company gateway, any OpenAI-style address. */
export function CustomForm({ existing, onSaved, onRemoved, onCancel }: CustomFormProps) {
  const [name, setName] = useState(existing?.name ?? '');
  const [baseUrl, setBaseUrl] = useState(existing?.baseUrl ?? '');
  const [protocol, setProtocol] = useState<Protocol>(existing?.protocol ?? 'openai');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const moved = Boolean(existing) && (existing?.baseUrl !== baseUrl.trim().replace(/\/+$/, '') || existing?.protocol !== protocol);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSaved(await saveCustomProvider({ id: existing?.id, name, baseUrl, protocol, key: key.trim() || undefined }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Couldn’t save that.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!existing) return;
    if (!confirmRemove) return setConfirmRemove(true);
    try {
      await removeCustomProvider(existing.id);
      removeProviderModels(existing.id);
      toast(`Removed ${existing.name}`);
      onRemoved();
    } catch {
      setError('Couldn’t remove it. Try again.');
    }
  }

  return (
    <form className="keys-form" onSubmit={event => void save(event)}>
      <label className="keys-label">Name
        <span className="field-wrap"><input className="field" value={name} onChange={e => setName(e.target.value)} placeholder="Ollama" maxLength={40} aria-label="Name" /></span>
      </label>
      <label className="keys-label">Address
        <span className="field-wrap"><input className="field" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="http://localhost:11434/v1" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} aria-label="Address" /></span>
      </label>
      <div className="keys-label">Speaks
        <div className="segmented" role="radiogroup" aria-label="Format">
          <button type="button" role="radio" aria-checked={protocol === 'openai'} aria-selected={protocol === 'openai'} onClick={() => setProtocol('openai')}>OpenAI-style</button>
          <button type="button" role="radio" aria-checked={protocol === 'anthropic'} aria-selected={protocol === 'anthropic'} onClick={() => setProtocol('anthropic')}>Anthropic-style</button>
        </div>
      </div>
      <label className="keys-label">Key <span className="keys-optional">{existing ? (moved ? 'the old key is removed when the address changes' : 'leave empty to keep the saved one') : 'optional: most servers on your own computer don’t need one'}</span>
        <span className="field-wrap"><input className="field" type="password" value={key} onChange={e => setKey(e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} aria-label="Key" /></span>
      </label>
      <p className="note">Use https://…, or http:// for a server on this computer or your own network. In a browser the server also has to allow this site (CORS); the desktop app has no such limit.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="keys-actions">
        <button className="btn btn-primary press" type="submit" disabled={busy || !name.trim() || !baseUrl.trim()}>{existing ? 'Save' : 'Add server'}</button>
        <button className="btn btn-soft press" type="button" onClick={onCancel}>Cancel</button>
        {existing && <button className="btn-link muted spacer-left" type="button" onClick={() => void remove()}>{confirmRemove ? 'Tap again to remove' : 'Remove this server'}</button>}
      </div>
    </form>
  );
}
