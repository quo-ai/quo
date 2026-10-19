import { FileText } from 'lucide-react';

/** The files the @ picker found, best first. Keys move through them; a click picks one. */
export function MentionList({ items, index, onHover, onPick }: { items: string[]; index: number; onHover: (index: number) => void; onPick: (file: string) => void }) {
  if (!items.length) return null;
  return (
    <div className="mention-list glass thick" role="listbox" aria-label="Files in the project">
      {items.map((file, i) => {
        const slash = file.lastIndexOf('/');
        return (
          <button key={file} type="button" role="option" aria-selected={i === index} className={`mention${i === index ? ' on' : ''}`} onMouseDown={event => event.preventDefault()} onMouseEnter={() => onHover(i)} onClick={() => onPick(file)}>
            <FileText size={14} />
            <span className="mention-name">{file.slice(slash + 1)}</span>
            {slash > 0 && <span className="mention-dir">{file.slice(0, slash)}</span>}
          </button>
        );
      })}
    </div>
  );
}
