import { useEffect, useRef, useState } from 'react';
import { Gauge } from 'lucide-react';
import { tightest, useClaudeUsage, windowName, type SavedUsage } from '../../providers/claudeUsage';

const levelOf = (used: number) => (used >= 90 ? 'full' : used >= 75 ? 'high' : 'ok');

function resetsText(at: number | null, now: number): string {
  if (!at) return '';
  if (at <= now) return 'has reset since';
  const date = new Date(at);
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return at - now < 20 * 3_600_000 ? `resets at ${time}` : `resets ${date.toLocaleDateString(undefined, { weekday: 'short' })} at ${time}`;
}

function agoText(at: number, now: number): string {
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : new Date(at).toLocaleDateString();
}

const EXTRA = { off: 'Off', available: 'Available when a limit is reached', in_use: 'In use now' } as const;

/** Each window of the person's Claude plan: how much is used and when it resets. Also on the Claude Agent page. */
export function PlanUsageDetails({ usage }: { usage: SavedUsage }) {
  const now = Date.now();
  return (
    <>
      {usage.windows.map(window => {
        const gone = window.resetsAt !== null && window.resetsAt <= now;
        return (
          <div className="plan-window" key={window.id}>
            <p className="ctx-line">{windowName(window.id)[0]}</p>
            <div className="ctx-bar" aria-hidden="true">
              <span className={`conv ${levelOf(window.used)}`} style={{ width: gone ? '0%' : `${window.used}%` }} />
            </div>
            <p className="ctx-sub">{gone ? 'Has reset since the last reply' : `${window.used}% used${window.resetsAt ? `, ${resetsText(window.resetsAt, now)}` : ''}`}</p>
          </div>
        );
      })}
      {usage.extra && <p className="ctx-sub">Extra usage: {EXTRA[usage.extra]}</p>}
      <p className="note">From Claude Code with your last reply, {agoText(usage.at, now)}. It updates with every message.</p>
    </>
  );
}

/** The person's Claude plan usage in the chat bar (Claude Agent): the window closest to its limit; open it for all of them. */
export function PlanUsage() {
  const usage = useClaudeUsage();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

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

  if (!usage || !usage.windows.length) return null;
  const top = tightest(usage);
  const label = top ? `${windowName(top.id)[1]} ${top.used}%` : 'Plan';

  return (
    <div className="ctx" ref={wrap}>
      <button type="button" className={`ctx-btn ${top ? levelOf(top.used) : 'ok'}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(o => !o)} title="How much of your Claude plan is used" aria-label={`Claude plan usage: ${label}`}>
        <Gauge size={15} aria-hidden="true" />
        <span>{label}</span>
      </button>
      {open && (
        <div className="ctx-pop glass thick" role="dialog" aria-label="Claude plan usage">
          <p className="ctx-title">Claude plan usage</p>
          <PlanUsageDetails usage={usage} />
        </div>
      )}
    </div>
  );
}
