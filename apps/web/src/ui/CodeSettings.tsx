import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { recentProjects } from '../agent/session';
import { STEP_CHOICES, setCodeSettings, useCodeSettings } from '../codeSettings';
import { agentBridge, unwrap, type CodeProject } from '../native';
import { toast } from './Toasts';
import { Toggle } from './Toggle';

/** How Code mode behaves, and the folders and downloads it remembers. Nothing here lets it do more without your OK. */
export function CodeSettings() {
  const settings = useCodeSettings();
  const [projects, setProjects] = useState<CodeProject[] | null>(null);

  useEffect(() => {
    void recentProjects().then(setProjects).catch(() => setProjects([]));
  }, []);

  async function forget(project: CodeProject) {
    try {
      unwrap(await agentBridge()!.forget(project.id));
      setProjects(list => list?.filter(entry => entry.id !== project.id) ?? null);
      toast(`Forgot ${project.name}`);
    } catch {
      toast('Couldn’t do that.');
    }
  }

  async function clearRepos() {
    try {
      unwrap(await agentBridge()!.clearRepos());
      toast('Removed the downloaded repositories');
    } catch {
      toast('Couldn’t do that.');
    }
  }

  return (
    <>
      <p className="note keys-intro">Code mode lets a model read your project, change files and run commands. You approve changes and commands in a window the page can’t click. These settings can only make it stricter, or choose how it starts.</p>
      <div className="toggle-list">
        <Toggle label="Run read-only commands without asking" detail="git status, git diff, git log and version checks. Off: every command asks." on={settings.autoReadOnly} onChange={autoReadOnly => setCodeSettings({ autoReadOnly })} />
        <Toggle label="Follow the project’s notes" detail="AGENTS.md or CLAUDE.md in the project folder: how to build, test and write code there." on={settings.useNotes} onChange={useNotes => setCodeSettings({ useNotes })} />
        <Toggle label="Start in plan mode" detail="Quo only reads and suggests a plan until you switch Plan off." on={settings.startInPlan} onChange={startInPlan => setCodeSettings({ startInPlan })} />
      </div>
      <div className="sheet-section-title">Most steps in one reply</div>
      <div className="segmented" role="radiogroup" aria-label="Most steps in one reply">
        {STEP_CHOICES.map(count => (
          <button key={count} type="button" role="radio" aria-checked={settings.maxSteps === count} aria-selected={settings.maxSteps === count} onClick={() => setCodeSettings({ maxSteps: count })}>{count}</button>
        ))}
      </div>
      <p className="note">Each step is one request to the model. A lower limit keeps a runaway reply cheap.</p>

      <div className="sheet-section-title">Project folders Quo remembers</div>
      {projects?.length === 0 && <p className="note">None yet. You choose a folder the first time you turn Code on.</p>}
      {projects?.map(project => (
        <div className="own-row" key={project.id}>
          <span className="grow"><span className="title">{project.name}</span></span>
          <button type="button" className="btn btn-soft press small" onClick={() => void forget(project)}><Trash2 size={13} /> Forget</button>
        </div>
      ))}
      <div className="sheet-section-title">Downloaded repositories</div>
      <p className="note">Public GitHub repositories Quo opened to read for reference are kept here for a while.</p>
      <button type="button" className="btn btn-soft press keys-browse" onClick={() => void clearRepos()}>Remove them</button>
    </>
  );
}
