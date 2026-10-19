import { useEffect, useState } from 'react';
import { FilePlus, Pencil } from 'lucide-react';
import type { CodeSession } from '../../agent/session';
import type { FileChange } from '../../native';

/** The files the agent changed in this session, newest first. */
export function ChangesList({ session, tick, selected, onSelect, onCount }: { session: CodeSession; tick: number; selected: string | null; onSelect: (change: FileChange) => void; onCount: (count: number) => void }) {
  const [changes, setChanges] = useState<FileChange[]>([]);

  useEffect(() => {
    let current = true;
    void session.changes().then(list => {
      if (!current) return;
      setChanges(list);
      onCount(list.length);
    }, () => {});
    return () => {
      current = false;
    };
  }, [session, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  if (changes.length === 0) return <p className="fp-note pad">Nothing has been changed in this chat yet. Files Quo creates or edits will be listed here.</p>;
  return (
    <div className="fp-tree">
      {changes.map(change => (
        <button key={change.path} type="button" className={`fp-row${selected === change.path ? ' selected' : ''}`} style={{ paddingLeft: 10 }} onClick={() => onSelect(change)} title={change.path}>
          {change.created ? <FilePlus size={15} /> : <Pencil size={15} />}
          <span className="fp-name">{change.path}</span>
          <span className="fp-counts"><span className="add">+{change.added}</span>{change.removed > 0 && <span className="del">−{change.removed}</span>}</span>
        </button>
      ))}
    </div>
  );
}
