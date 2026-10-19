import { useEffect, useState } from 'react';
import { FolderOpen, FolderSearch, GitBranch, RefreshCw, X } from 'lucide-react';
import { codePanel, useCodePanel } from '../agent/codePanel';
import type { FileChange } from '../native';
import { ChangesList } from './panel/ChangesList';
import { FileTree } from './panel/FileTree';
import { FileViewer } from './panel/FileViewer';

/**
 * The project beside the chat: its files, one folder at a time, a place to look inside a file, and what the agent has
 * changed. For looking only (nothing here edits a file), with the same rules the agent's reading has: nothing outside the
 * project, no secrets, no .git. Pages and images can be opened in the browser, after approval in the app's own window.
 */
export function FilePanel() {
  const { session, open, tick, tab, path, line, busy } = useCodePanel();
  const [change, setChange] = useState<FileChange | null>(null);
  const [count, setCount] = useState(0);

  // Looking at a change belongs to the Changes tab; picking a file or a link leaves it.
  useEffect(() => {
    if (tab === 'files') setChange(null);
  }, [tab, path]);

  if (!session || !open) return null;
  const git = session.info.git;
  const showing = change?.path ?? path;

  return (
    <aside className="filepanel glass" aria-label="Project files">
      <div className="fp-head">
        <FolderOpen size={17} />
        <div className="fp-title">
          <span className="fp-project" title={session.project.name}>{session.project.name}</span>
          {git?.branch && <span className="fp-branch"><GitBranch size={11} /> {git.branch}</span>}
        </div>
        {busy && <span className="fp-busy" title="Quo is working" />}
        <button type="button" className="icon-btn" title="Refresh" aria-label="Refresh" onClick={() => codePanel.bump()}><RefreshCw size={15} /></button>
        <button type="button" className="icon-btn" title="Show the project in the file manager" aria-label="Show the project in the file manager" onClick={() => void session.reveal('.').catch(() => {})}><FolderSearch size={15} /></button>
        <button type="button" className="icon-btn" title="Close (Ctrl+Shift+E)" aria-label="Close the file panel" onClick={() => codePanel.close()}><X size={16} /></button>
      </div>
      <div className="fp-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'files'} onClick={() => codePanel.setTab('files')}>Files</button>
        <button type="button" role="tab" aria-selected={tab === 'changes'} onClick={() => codePanel.setTab('changes')}>Changes{count > 0 && <span className="fp-badge">{count}</span>}</button>
      </div>
      <div className={`fp-split${showing ? ' with-viewer' : ''}`}>
        <div className="fp-list">
          {tab === 'files'
            ? <FileTree session={session} tick={tick} selected={path} onSelect={next => codePanel.openFile(next)} />
            : <ChangesList session={session} tick={tick} selected={change?.path ?? null} onSelect={next => { setChange(next); codePanel.openFile(next.path); codePanel.setTab('changes'); }} onCount={setCount} />}
        </div>
        {showing && <FileViewer session={session} path={showing} line={tab === 'files' ? line : null} change={tab === 'changes' ? change : null} onClose={() => { setChange(null); codePanel.closeFile(); }} />}
      </div>
    </aside>
  );
}
