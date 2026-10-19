import { FolderLock, ListChecks } from 'lucide-react';
import type { CodeSession } from '../agent/session';
import type { CodeProject } from '../native';
import { ProjectMenu } from './chat/ProjectMenu';

interface CodeChipProps {
  starting: boolean;
  disabled: boolean;
  /** The running Code session, which knows its folder, its branch and the project's notes. Null when this chat has no folder. */
  session: CodeSession | null;
  /** Plan mode: only reading. */
  plan: boolean;
  onTogglePlan: () => void;
  onSwitchProject: (project: CodeProject) => void;
  onChooseFolder: () => void;
  onRemove: () => void;
  /** Why there can be no folder with this model: shown instead of the folder, disabled. */
  unavailable?: string | null;
}

/**
 * The project folder, always shown next to the message box, and plan mode once there is one. There is no switch to turn
 * Code mode on: adding a folder is what makes it available, and the model uses it when the request needs it. Sending a
 * message that is about the project adds the folder used last by itself (useCodeMode.autoStart).
 */
export function CodeChip({ starting, disabled, session, plan, onTogglePlan, onSwitchProject, onChooseFolder, onRemove, unavailable }: CodeChipProps) {
  if (unavailable) {
    return (
      <button type="button" className="chip empty" aria-disabled="true" title={unavailable} onClick={event => event.preventDefault()}>
        <FolderLock size={14} /> <span className="chip-name">No folder</span>
      </button>
    );
  }
  return (
    <>
      <ProjectMenu project={session?.project ?? null} info={session?.info ?? null} disabled={disabled} starting={starting} onPick={onSwitchProject} onBrowse={onChooseFolder} onRemove={onRemove} />
      {session && (
        <button type="button" className="chip press" aria-pressed={plan} disabled={disabled} onClick={onTogglePlan} title="Plan mode: Quo only reads, and suggests a plan. Nothing is changed or run.">
          <ListChecks size={14} /> Plan
        </button>
      )}
    </>
  );
}
