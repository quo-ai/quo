import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, FolderOpen, FolderPlus, GitBranch, Loader2, X } from 'lucide-react';
import { recentProjects } from '../../agent/session';
import type { CodeProject, CodeSessionInfo } from '../../native';

interface ProjectMenuProps {
  /** The folder in use, or null when there is none yet. */
  project: CodeProject | null;
  info: CodeSessionInfo | null;
  disabled: boolean;
  starting?: boolean;
  onPick: (project: CodeProject) => void;
  onBrowse: () => void;
  /** Stop using the folder in this chat. */
  onRemove?: () => void;
}

/**
 * The project folder, always shown: the one Quo works in (with the branch, if it has one), or "No folder" when it has none.
 * Pick a recent one or another, or take it away from this chat. Adding a folder is what lets Quo read and change code.
 */
export function ProjectMenu({ project, info, disabled, starting = false, onPick, onBrowse, onRemove }: ProjectMenuProps) {
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<CodeProject[] | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const git = info?.git ?? null;

  useEffect(() => {
    if (!open) return;
    void recentProjects().then(setRecent).catch(() => setRecent([]));
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
      <button
        type="button"
        className={`chip press${project ? '' : ' empty'}`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled || starting}
        onClick={() => setOpen(o => !o)}
        title={project
          ? `${project.name}${info?.hint ? ` · ${info.hint}` : ''}. Quo reads files here, and changes them or runs commands only when you say yes each time.`
          : 'No project folder. Add one and Quo can read your code, make changes and run commands there, asking you each time.'}
      >
        {starting ? <Loader2 size={14} className="spin" /> : <FolderOpen size={14} />} <span className="chip-name">{project ? project.name : 'No folder'}</span>
        {git?.branch && <span className="chip-sub"><GitBranch size={12} /> <span className="chip-name">{git.branch}</span>{git.changed ? ` +${git.changed}` : ''}</span>}
        <ChevronDown size={13} />
      </button>
      {open && (
        <div className="menu-up glass thick" role="menu">
          <div className="menu-head">Project folder</div>
          {(recent ?? (project ? [project] : [])).map(entry => (
            <button key={entry.id} type="button" className="menu-item press" role="menuitemradio" aria-checked={entry.id === project?.id} onClick={() => { setOpen(false); if (entry.id !== project?.id) onPick(entry); }}>
              <span className="grow">
                <span className="title">{entry.name}</span>
                {entry.hint && <span className="sub">{entry.hint}</span>}
              </span>
              {entry.id === project?.id && <Check size={17} className="check" />}
            </button>
          ))}
          {recent !== null && recent.length === 0 && !project && <p className="menu-note">Quo works in a folder you choose, and asks before it changes anything.</p>}
          {((recent?.length ?? 0) > 0 || project) && <div className="menu-divider" />}
          <button type="button" className="menu-item press" role="menuitem" onClick={() => { setOpen(false); onBrowse(); }}>
            <FolderPlus size={17} color="var(--text-2)" />
            <span className="grow"><span className="title">{project ? 'Choose another folder…' : 'Choose a folder…'}</span></span>
          </button>
          {project && onRemove && (
            <button type="button" className="menu-item press" role="menuitem" onClick={() => { setOpen(false); onRemove(); }}>
              <X size={17} color="var(--text-2)" />
              <span className="grow"><span className="title">Don’t use a folder in this chat</span></span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
