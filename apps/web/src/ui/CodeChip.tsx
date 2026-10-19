import { Code2, ListChecks, Loader2 } from 'lucide-react';
import type { CodeSession } from '../agent/session';
import type { CodeProject } from '../native';
import { ProjectMenu } from './chat/ProjectMenu';

interface CodeChipProps {
  active: boolean;
  starting: boolean;
  disabled: boolean;
  /** The running Code session, which knows its folder, its branch and the project's notes. */
  session: CodeSession | null;
  /** Plan mode: only reading. */
  plan: boolean;
  onToggle: () => void;
  onTogglePlan: () => void;
  onSwitchProject: (project: CodeProject) => void;
  onChooseFolder: () => void;
}

/** Turns Code mode on or off, shows the folder it works in (and switches it), and offers plan mode (read-only). */
export function CodeChip({ active, starting, disabled, session, plan, onToggle, onTogglePlan, onSwitchProject, onChooseFolder }: CodeChipProps) {
  const notes = session?.info.instructions?.file;
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
        {starting ? <Loader2 size={14} className="spin" /> : <Code2 size={14} />} Code
      </button>
      {active && session && (
        <>
          <ProjectMenu project={session.project} info={session.info} disabled={disabled} onPick={onSwitchProject} onBrowse={onChooseFolder} />
          <button type="button" className="chip press" aria-pressed={plan} disabled={disabled} onClick={onTogglePlan} title="Plan mode: Quo only reads, and suggests a plan. Nothing is changed or run.">
            <ListChecks size={14} /> Plan
          </button>
        </>
      )}
    </>
  );
}
