import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ListChecks, ShieldAlert, ShieldCheck, ShieldOff } from 'lucide-react';
import type { Autonomy } from '../../native';

/**
 * How Quo Code works in this session: plan mode (read only), or how much it does without asking (desktop
 * agent/autonomy.js). A looser level is confirmed in the desktop app's own window; pushes always ask.
 */
const LEVELS: { id: Autonomy; label: string; sub: string; icon: typeof ShieldCheck }[] = [
  { id: 'ask', label: 'Ask first', sub: 'Asks before every change and command.', icon: ShieldCheck },
  { id: 'risky', label: 'Ask if risky', sub: 'Works on its own; asks before deleting, installing, the internet, files outside the project, commits and pushes.', icon: ShieldAlert },
  { id: 'all', label: 'Don’t ask', sub: 'Does everything on its own; asks only before a push. For projects you trust.', icon: ShieldOff },
];

export function ModeMenu({ plan, autonomy, disabled, onTogglePlan, onAutonomy }: { plan: boolean; autonomy: Autonomy; disabled: boolean; onTogglePlan: () => void; onAutonomy: (level: Autonomy) => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => { if (!wrap.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const current = LEVELS.find(level => level.id === autonomy) ?? LEVELS[0];
  const Icon = plan ? ListChecks : current.icon;
  return (
    <div className="ctx" ref={wrap}>
      <button type="button" className="chip press plan-chip" aria-haspopup="menu" aria-expanded={open} aria-pressed={plan || autonomy !== 'ask'} disabled={disabled} onClick={() => setOpen(o => !o)} title={plan ? 'Plan mode: Quo only reads, and suggests a plan. Nothing is changed or run.' : current.sub}>
        <Icon size={14} /> {plan ? 'Plan' : current.label} <ChevronDown size={13} />
      </button>
      {open && (
        <div className="menu-up glass thick" role="menu">
          <div className="menu-head">How Quo works here</div>
          {LEVELS.map(level => (
            <button key={level.id} type="button" className="menu-item press" role="menuitemradio" aria-checked={!plan && level.id === autonomy} onClick={() => { setOpen(false); if (plan) onTogglePlan(); if (level.id !== autonomy) onAutonomy(level.id); }}>
              <level.icon size={17} color="var(--ink-2)" />
              <span className="grow"><span className="title">{level.label}</span><span className="sub">{level.sub}</span></span>
              {!plan && level.id === autonomy && <Check size={17} className="check" />}
            </button>
          ))}
          <div className="menu-divider" />
          <button type="button" className="menu-item press" role="menuitemradio" aria-checked={plan} onClick={() => { setOpen(false); onTogglePlan(); }}>
            <ListChecks size={17} color="var(--ink-2)" />
            <span className="grow"><span className="title">Plan only</span><span className="sub">Reads and suggests a plan. Nothing is changed or run.</span></span>
            {plan && <Check size={17} className="check" />}
          </button>
        </div>
      )}
    </div>
  );
}
