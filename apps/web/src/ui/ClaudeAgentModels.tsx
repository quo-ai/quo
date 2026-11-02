import { useState } from 'react';
import { Check, ChevronDown, ChevronRight, KeyRound } from 'lucide-react';
import type { ClaudeModel } from '../native';
import { CLAUDE_AGENT, listedModel } from '../providers/claudeAgent';
import { useClaudeModels } from '../providers/claudeCatalog';
import { addOwnModel, ownModelId, type OwnModel } from '../providers/ownModels';

interface ClaudeAgentModelsProps {
  /** The Claude Agent models already added (including any typed in by name). */
  own: OwnModel[];
  selected: string | null;
  onPick: (key: string) => void;
}

const contextOf = (tokens?: number) => (!tokens ? '' : tokens >= 1_000_000 ? `${tokens / 1_000_000}M context` : `${Math.round(tokens / 1000)}k context`);

/**
 * Claude Agent in the model menu: every model Claude Code offers this person, not only the ones added. Its short names
 * (always the newest) are listed; the specific versions open under one row. Choosing one adds it and switches to it.
 */
export function ClaudeAgentModels({ own, selected, onPick }: ClaudeAgentModelsProps) {
  const offered = useClaudeModels();
  const keyOf = (id: string) => `own:${ownModelId(CLAUDE_AGENT.id, id)}`;
  const pinned = offered.filter(model => model.pinned);
  const [showPinned, setShowPinned] = useState(() => pinned.some(model => keyOf(model.id) === selected));
  const newest = offered.filter(model => !model.pinned);
  // Added by name, or from before the list was known.
  const others = own.filter(model => !offered.some(listed => listed.id === model.apiModel));

  const choose = (model: ClaudeModel) => {
    const listed = listedModel(model);
    addOwnModel(CLAUDE_AGENT, model.id, { name: model.name, contextTokens: listed.contextTokens, thinking: listed.thinking, thinkingHints: listed.thinkingHints, thinkingDefault: listed.thinkingDefault, agent: true });
    onPick(keyOf(model.id));
  };
  const row = (key: string, title: string, sub: string, onClick: () => void) => (
    <button key={key} className="menu-item press" role="menuitemradio" aria-checked={selected === key} onClick={onClick}>
      <span className="grow">
        <span className="title">{title}</span>
        {sub && <span className="sub">{sub}</span>}
      </span>
      {selected === key && <Check className="check" size={18} />}
    </button>
  );

  return (
    <>
      <div className="popover-section"><KeyRound size={13} /> {CLAUDE_AGENT.name}</div>
      {newest.map(model => row(keyOf(model.id), model.name, [model.resolved, model.description.replace(/^[^·]*·\s*/, '')].filter(Boolean).join(' · '), () => choose(model)))}
      {others.map(model => row(`own:${model.id}`, model.name, model.name !== model.apiModel ? model.apiModel : '', () => onPick(`own:${model.id}`)))}
      {pinned.length > 0 && (
        <button className="menu-item press" aria-expanded={showPinned} onClick={() => setShowPinned(shown => !shown)}>
          <span className="grow">
            <span className="title">Specific versions</span>
            <span className="sub">{pinned.length} models that stay the same when a newer one comes out</span>
          </span>
          {showPinned ? <ChevronDown size={17} color="var(--text-3)" /> : <ChevronRight size={17} color="var(--text-3)" />}
        </button>
      )}
      {showPinned && pinned.map(model => row(keyOf(model.id), model.name, [model.id, contextOf(model.contextTokens), model.description].filter(Boolean).join(' · '), () => choose(model)))}
    </>
  );
}
