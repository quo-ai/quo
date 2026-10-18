import { useState } from 'react';
import { Check, Code2, Plus, X } from 'lucide-react';
import { agentBridge } from '../../native';
import type { ListedModel } from '../../providers/listing';
import { addOwnModel, removeOwnModel, setOwnModelAgent, useOwnModels } from '../../providers/ownModels';
import type { ProviderInfo } from '../../providers/registry';

const SHOWN = 60;

interface ProviderModelsProps {
  provider: ProviderInfo;
  /** What the provider offers, once asked. */
  listed: ListedModel[] | null;
  loading: boolean;
  /** Why the list couldn't be had. */
  problem: string | null;
  selectedKey: string | null;
  onLoad: () => void;
  onUse: (key: string) => void;
}

/** The models you use from this provider, and a list of the ones it offers to add. */
export function ProviderModels({ provider, listed, loading, problem, selectedKey, onLoad, onUse }: ProviderModelsProps) {
  const chosen = useOwnModels().filter(model => model.provider === provider.id);
  const [query, setQuery] = useState('');
  const [typed, setTyped] = useState('');
  const canCode = Boolean(agentBridge());
  const have = new Set(chosen.map(model => model.apiModel));
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (listed ?? []).filter(model => !have.has(model.id) && words.every(word => `${model.name} ${model.id}`.toLowerCase().includes(word)));

  function addTyped() {
    const id = typed.trim();
    if (!id) return;
    addOwnModel(provider, id);
    setTyped('');
  }

  return (
    <>
      <div className="sheet-section-title">Models you use</div>
      {chosen.length === 0 && <p className="note">None yet. Add one below, then pick it from the model menu.</p>}
      {chosen.map(model => {
        const key = `own:${model.id}`;
        return (
          <div className="own-row" key={model.id}>
            <span className="grow">
              <span className="title">{model.name}</span>
              {model.name !== model.apiModel && <span className="sub">{model.apiModel}</span>}
            </span>
            {canCode && (
              <button type="button" className="chip press" aria-pressed={model.agent} onClick={() => setOwnModelAgent(model.id, !model.agent)} title="Let this model work on your project in Code mode. It needs a model that can call tools.">
                <Code2 size={13} /> Code
              </button>
            )}
            <button type="button" className="btn btn-soft press small" disabled={selectedKey === key} onClick={() => onUse(key)}>{selectedKey === key ? 'In use' : 'Use'}</button>
            <button type="button" className="icon-btn press" onClick={() => removeOwnModel(model.id)} aria-label={`Stop using ${model.name}`} title="Stop using this model"><X size={16} /></button>
          </div>
        );
      })}

      <div className="sheet-section-title">Add a model</div>
      <div className="keys-add">
        <span className="field-wrap"><input className="field" value={typed} onChange={e => setTyped(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTyped(); } }} placeholder="Type a model name, as the provider calls it" autoCapitalize="off" autoCorrect="off" spellCheck={false} aria-label="Model name" /></span>
        <button type="button" className="btn btn-soft press" onClick={addTyped} disabled={!typed.trim()}><Plus size={15} /> Add</button>
      </div>

      {listed === null ? (
        <button type="button" className="btn btn-soft press keys-browse" onClick={onLoad} disabled={loading}>{loading ? 'Loading…' : `See what ${provider.name} offers`}</button>
      ) : (
        <>
          <span className="field-wrap keys-search"><input className="field" value={query} onChange={e => setQuery(e.target.value)} placeholder={`Search ${listed.length} models`} aria-label="Search models" /></span>
          <div className="own-list">
            {matches.slice(0, SHOWN).map(model => (
              <button key={model.id} type="button" className="menu-item press" onClick={() => addOwnModel(provider, model.id, { name: model.name, contextTokens: model.contextTokens, agent: model.tools })}>
                <span className="grow">
                  <span className="title">{model.name}</span>
                  {model.name !== model.id && <span className="sub">{model.id}</span>}
                </span>
                <Plus size={16} color="var(--text-3)" />
              </button>
            ))}
            {matches.length === 0 && <p className="note">{listed.length === 0 ? 'The provider didn’t list any models. Type a name above.' : have.size && !query ? <><Check size={13} /> That’s everything.</> : 'No match.'}</p>}
            {matches.length > SHOWN && <p className="note">Showing {SHOWN} of {matches.length}. Search to narrow it down.</p>}
          </div>
        </>
      )}
      {problem && <p className="error" role="alert">{problem}</p>}
    </>
  );
}
