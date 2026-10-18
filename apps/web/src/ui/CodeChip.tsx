import { Code2, FolderOpen, ListChecks, Loader2 } from 'lucide-react';

interface CodeChipProps {
  active: boolean;
  starting: boolean;
  disabled: boolean;
  project: string | null;
  /** Plan mode: only reading. */
  plan: boolean;
  /** The project's notes file Quo is following (AGENTS.md or CLAUDE.md), if any. */
  notes: string | null;
  onToggle: () => void;
  onChangeFolder: () => void;
  onTogglePlan: () => void;
}

/** Turns Code mode on or off, shows which folder it works in, and offers plan mode (read-only). */
export function CodeChip({ active, starting, disabled, project, plan, notes, onToggle, onChangeFolder, onTogglePlan }: CodeChipProps) {
  return (
    <>
      <button
        type="button"
        className="chip press"
        aria-pressed={active}
        disabled={disabled || starting}
        onClick={onToggle}
        title={active
          ? `Code mode is on. It reads files in this folder, and changes them or runs commands only when you say yes each time.${notes ? ` It follows the notes in ${notes}.` : ''}`
          : 'Let this model work in one of your project folders: read code, make changes, run commands. You approve every change.'}
      >
        {starting ? <Loader2 size={14} className="spin" /> : <Code2 size={14} />} Code{active && project ? ` · ${project}` : ''}
      </button>
      {active && (
        <>
          <button type="button" className="chip press" aria-pressed={plan} disabled={disabled} onClick={onTogglePlan} title="Plan mode: Quo only reads, and suggests a plan. Nothing is changed or run.">
            <ListChecks size={14} /> Plan
          </button>
          <button type="button" className="icon-btn round press" disabled={disabled} onClick={onChangeFolder} aria-label="Use a different folder" title="Use a different folder">
            <FolderOpen size={16} />
          </button>
        </>
      )}
    </>
  );
}
