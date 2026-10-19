import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { agentBridge } from '../native';
import { keyLabel, SHORTCUTS } from './shortcuts';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** Every keyboard shortcut, grouped. The project ones only appear where there is a project folder to work in. */
export function ShortcutsSheet({ onClose }: { onClose: () => void }) {
  const sheet = useRef<HTMLDivElement>(null);
  const desktop = Boolean(agentBridge());

  useEffect(() => {
    sheet.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="scrim" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="sheet glass thick" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title" tabIndex={-1} ref={sheet}>
        <div className="sheet-head">
          <h2 id="shortcuts-title">Keyboard shortcuts</h2>
          <button className="icon-btn round press" onClick={onClose} aria-label="Close"><X size={19} /></button>
        </div>
        <div className="sheet-body">
          {SHORTCUTS.map(group => {
            const items = group.items.filter(item => desktop || !item.project);
            if (group.title.startsWith('When Quo asks') && !desktop) return null;
            return items.length === 0 ? null : (
              <section key={group.title}>
                <div className="sheet-section-title">{group.title}</div>
                <dl className="shortcut-list">
                  {items.map(item => (
                    <div key={item.what} className="shortcut-row">
                      <dt>{item.what}</dt>
                      <dd>{item.keys.map((key, index) => <kbd key={index}>{keyLabel(key, isMac)}</kbd>)}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
