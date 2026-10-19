import { useEffect, useRef, useState } from 'react';
import { Copy, FolderSearch, Globe, X } from 'lucide-react';
import type { CodeSession } from '../../agent/session';
import type { FileChange, FileView } from '../../native';
import { toast } from '../Toasts';

/** A diff with the added and removed lines coloured. */
export function DiffLines({ diff }: { diff: string }) {
  return (
    <pre className="fp-code diff">
      {diff.split('\n').map((line, index) => <span key={index} className={`fp-line${line.startsWith('+') ? ' add' : line.startsWith('-') ? ' del' : line.startsWith('@@') ? ' hunk' : ''}`}>{line || ' '}{'\n'}</span>)}
    </pre>
  );
}

const fail = (error: unknown, fallback: string) => toast(error instanceof Error && error.message ? error.message : fallback);

/** One file to look at, or the change the agent made to it. Offers opening a page in the browser (approved in its own window). */
export function FileViewer({ session, path, line, change, onClose }: { session: CodeSession; path: string; line: number | null; change: FileChange | null; onClose: () => void }) {
  const [view, setView] = useState<FileView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let current = true;
    setView(null);
    setError(null);
    void session.view(path).then(result => current && setView(result), caught => current && setError(caught instanceof Error ? caught.message : 'Couldn’t open this file.'));
    return () => {
      current = false;
    };
  }, [session, path]);

  // Bring a line from a link into view.
  useEffect(() => {
    if (!line || !view || view.kind !== 'text') return;
    body.current?.querySelector(`[data-line="${line}"]`)?.scrollIntoView({ block: 'center' });
  }, [line, view]);

  const lines = view?.kind === 'text' ? (view.text ?? '').split('\n') : [];
  return (
    <div className="fp-viewer">
      <div className="fp-viewer-head">
        <span className="fp-viewer-path" title={path}>{path}</span>
        {view?.canOpen && <button type="button" className="icon-btn" title="Open in your browser" aria-label="Open in your browser" onClick={() => void session.openInBrowser(path).catch(caught => fail(caught, 'Couldn’t open it.'))}><Globe size={15} /></button>}
        <button type="button" className="icon-btn" title="Show in the file manager" aria-label="Show in the file manager" onClick={() => void session.reveal(path).catch(caught => fail(caught, 'Couldn’t show it.'))}><FolderSearch size={15} /></button>
        <button type="button" className="icon-btn" title="Copy the path" aria-label="Copy the path" onClick={() => void navigator.clipboard.writeText(path).then(() => toast('Copied the path'), () => {})}><Copy size={15} /></button>
        <button type="button" className="icon-btn" title="Close" aria-label="Close the file" onClick={onClose}><X size={15} /></button>
      </div>
      <div className="fp-viewer-body" ref={body}>
        {change ? <DiffLines diff={change.diff} />
          : error ? <p className="fp-note">{error}</p>
          : !view ? <p className="fp-note">Loading…</p>
          : view.kind === 'image' ? <img className="fp-image" src={view.dataUrl} alt={path} />
          : view.kind === 'binary' ? <p className="fp-note">This is a binary file, so it can’t be shown as text.</p>
          : view.kind === 'toolarge' ? <p className="fp-note">This file is too large to show here.</p>
          : (
            <pre className="fp-code">
              {lines.map((text, index) => <span key={index} data-line={index + 1} className={`fp-line${line === index + 1 ? ' hit' : ''}`}><span className="fp-ln">{index + 1}</span>{text || ' '}{'\n'}</span>)}
              {view.clipped && <span className="fp-line hunk">… the rest of this file is not shown</span>}
            </pre>
          )}
      </div>
    </div>
  );
}

