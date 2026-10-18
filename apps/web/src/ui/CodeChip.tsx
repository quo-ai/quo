import { Code2, FolderOpen, Loader2 } from 'lucide-react';

interface CodeChipProps {
  active: boolean;
  starting: boolean;
  disabled: boolean;
  project: string | null;
  onToggle: () => void;
  onChangeFolder: () => void;
}

/** Turns Code mode on or off, and shows which folder it works in. */
export function CodeChip({ active, starting, disabled, project, onToggle, onChangeFolder }: CodeChipProps) {
  return (
    <>
      <button
        type="button"
        className="chip press"
        aria-pressed={active}
        disabled={disabled || starting}
        onClick={onToggle}
        title={active ? 'Code mode is on. It reads files in this folder, and changes them or runs commands only when you say yes each time.' : 'Let this model work in one of your project folders: read code, make changes, run commands. You approve every change.'}
      >
        {starting ? <Loader2 size={14} className="spin" /> : <Code2 size={14} />} Code{active && project ? ` · ${project}` : ''}
      </button>
      {active && (
        <button type="button" className="icon-btn round press" disabled={disabled} onClick={onChangeFolder} aria-label="Use a different folder" title="Use a different folder">
          <FolderOpen size={16} />
        </button>
      )}
    </>
  );
}
