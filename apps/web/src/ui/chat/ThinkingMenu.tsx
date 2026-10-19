import { useEffect, useRef, useState } from 'react';
import { Brain, Check, ChevronDown } from 'lucide-react';
import type { ThinkLevel } from '../../../shared/thinking';
import { LEVEL_LABEL, levelHint } from '../../chat/thinking';

interface ThinkingMenuProps {
  levels: ThinkLevel[];
  value: ThinkLevel;
  onChange: (level: ThinkLevel) => void;
  disabled?: boolean;
  /** An offline model: it either reasons or it doesn't, so the top level reads "On". */
  local?: boolean;
}

/** How much the model thinks. Only the levels this model really has are listed. */
export function ThinkingMenu({ levels, value, onChange, disabled, local = false }: ThinkingMenuProps) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const label = (level: ThinkLevel) => (local && level === 'deep' ? 'On' : LEVEL_LABEL[level]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="ctx" ref={wrap}>
      <button type="button" className="chip press" aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => setOpen(o => !o)} title={`Thinking: ${levelHint(value, local)}`}>
        <Brain size={14} /> <span className="chip-name">{local ? (value === 'off' ? 'Think' : 'Thinking') : `Thinking · ${label(value)}`}</span> <ChevronDown size={13} />
      </button>
      {open && (
        <div className="menu-up glass thick" role="menu">
          <div className="menu-head">Thinking</div>
          {levels.map(level => (
            <button key={level} type="button" className="menu-item press" role="menuitemradio" aria-checked={level === value} onClick={() => { setOpen(false); onChange(level); }}>
              <span className="grow">
                <span className="title">{label(level)}</span>
                <span className="sub">{levelHint(level, local)}</span>
              </span>
              {level === value && <Check size={17} className="check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
