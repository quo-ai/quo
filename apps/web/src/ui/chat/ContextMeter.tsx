import { useEffect, useRef, useState } from 'react';
import { setAutoSummarize, useAutoSummarize } from '../../context/settings';
import { formatTokens, ratio, type ContextUsage } from '../../context/usage';

interface ContextMeterProps {
  usage: ContextUsage;
  busy: boolean;
  /** There are enough messages to be worth summarising. */
  canSummarize: boolean;
  onSummarize: () => void;
  onNewChat: () => void;
}

const RING = 2 * Math.PI * 7;

/** How full the model's memory is, as a small ring in the chat bar. Open it to see what fills it, and to make room. */
export function ContextMeter({ usage, busy, canSummarize, onSummarize, onNewChat }: ContextMeterProps) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const auto = useAutoSummarize();
  const share = ratio(usage);
  const percent = share === null ? null : Math.min(100, Math.round(share * 100));
  const level = share === null ? 'ok' : share >= 0.95 ? 'full' : share >= 0.8 ? 'high' : 'ok';

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

  const conversation = Math.max(0, usage.used - usage.fixed);
  const width = (part: number) => `${usage.limit ? Math.min(100, (part / usage.limit) * 100) : 0}%`;

  return (
    <div className="ctx" ref={wrap}>
      <button type="button" className={`ctx-btn ${level}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(o => !o)} title="How much of the model’s memory this conversation uses" aria-label={`Memory used: ${percent === null ? `about ${formatTokens(usage.used)} tokens` : `${percent}%`}`}>
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <circle cx="9" cy="9" r="7" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.4" />
          {share !== null && <circle cx="9" cy="9" r="7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeDasharray={`${Math.min(1, share) * RING} ${RING}`} transform="rotate(-90 9 9)" />}
        </svg>
        <span>{percent === null ? formatTokens(usage.used) : `${percent}%`}</span>
      </button>
      {open && (
        <div className="ctx-pop glass thick" role="dialog" aria-label="Conversation memory">
          <p className="ctx-title">Conversation memory</p>
          {usage.limit && (
            <div className="ctx-bar" aria-hidden="true">
              <span className="fixed" style={{ width: width(usage.fixed) }} />
              <span className={`conv ${level}`} style={{ width: width(conversation) }} />
            </div>
          )}
          <p className="ctx-line">{usage.limit ? `${formatTokens(usage.used)} of ${formatTokens(usage.limit)} tokens (${percent}%)` : `About ${formatTokens(usage.used)} tokens`} · {usage.exact ? 'counted by the provider' : 'estimated'}</p>
          <p className="ctx-sub">Rules and tools {formatTokens(usage.fixed)} · conversation {formatTokens(conversation)}</p>
          <p className="note">When it fills, old tool output is dropped, and Quo can summarise the earlier messages so the conversation goes on.</p>
          <div className="ctx-actions">
            <button type="button" className="btn btn-soft press small" disabled={busy || !canSummarize} onClick={() => { setOpen(false); onSummarize(); }}>Summarise earlier messages</button>
            <button type="button" className="btn btn-soft press small" onClick={() => { setOpen(false); onNewChat(); }}>New chat</button>
          </div>
          <label className="check"><input type="checkbox" checked={auto} onChange={event => setAutoSummarize(event.target.checked)} /><span>Summarise by itself when it is nearly full</span></label>
        </div>
      )}
    </div>
  );
}
