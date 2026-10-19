import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, FolderOpen, FolderPlus, GitBranch } from 'lucide-react';
import { recentProjects } from '../../agent/session';
import type { CodeProject, CodeSessionInfo } from '../../native';

interface ProjectMenuProps {
  project: CodeProject;
  info: CodeSessionInfo;
  disabled: boolean;
  onPick: (project: CodeProject) => void;
  onBrowse: () => void;
}

/** The project folder Code mode works in: shows it (with the branch, if it has one) and switches to a recent one or another. */
export function ProjectMenu({ project, info, disabled, onPick, onBrowse }: ProjectMenuProps) {
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<CodeProject[] | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const { git } = info;

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
      <button type="button" className="chip press" aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => setOpen(o => !o)} title={`${project.name}${info.hint ? ` · ${info.hint}` : ''}${git?.branch ? ` · on ${git.branch}${git.changed ? `, ${git.changed} changed file${git.changed === 1 ? '' : 's'}` : ''}` : ''}`}>
        <FolderOpen size={14} /> <span className="chip-name">{project.name}</span>
        {git?.branch && <span className="chip-sub"><GitBranch size={12} /> <span className="chip-name">{git.branch}</span>{git.changed ? ` +${git.changed}` : ''}</span>}
        <ChevronDown size={13} />
      </button>
      {open && (
        <div className="menu-up glass thick" role="menu">
          <div className="menu-head">Project folder</div>
          {(recent ?? [project]).map(entry => (
            <button key={entry.id} type="button" className="menu-item press" role="menuitemradio" aria-checked={entry.id === project.id} onClick={() => { setOpen(false); if (entry.id !== project.id) onPick(entry); }}>
              <span className="grow">
                <span className="title">{entry.name}</span>
                {entry.hint && <span className="sub">{entry.hint}</span>}
              </span>
              {entry.id === project.id && <Check size={17} className="check" />}
            </button>
          ))}
          <div className="menu-divider" />
          <button type="button" className="menu-item press" role="menuitem" onClick={() => { setOpen(false); onBrowse(); }}>
            <FolderPlus size={17} color="var(--text-2)" />
            <span className="grow"><span className="title">Choose another folder…</span></span>
          </button>
        </div>
      )}
    </div>
  );
}
