import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { isLocalCodeAllowed, ratingNote, setLocalCodeAllowed, useLocalCodeChoices } from '../agent/capability';
import { recentProjects } from '../agent/session';
import { allLocalModels } from '../catalog';
import { STEP_CHOICES, setCodeSettings, useCodeSettings } from '../codeSettings';
import { useCustomModels } from '../customModels';
import { agentBridge, hasNativeEngine, unwrap, type CodeProject } from '../native';
import type { DownloadState } from '../storage/downloads';
import { toast } from './Toasts';
import { Toggle } from './Toggle';

/** How Code mode behaves, and the folders and downloads it remembers. Nothing here lets it do more without your OK. */
export function CodeSettings({ downloads }: { downloads: Record<string, DownloadState> }) {
  const settings = useCodeSettings();
  useLocalCodeChoices();
  useCustomModels();
  const offline = hasNativeEngine() ? allLocalModels().filter(model => downloads[model.id]?.status === 'installed') : [];
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
        <Toggle label="Let Quo open a project folder when a request needs it" detail="Quo decides from your message. If it needs your files, it uses the folder you used last (or asks you to choose one), or makes a new folder for something built from scratch. You always see the folder next to the message box and can remove it. Off: add a folder yourself." on={settings.autoStart} onChange={autoStart => setCodeSettings({ autoStart })} />
        <Toggle label="Credit Quo in commits" detail="When Quo commits for you, a Co-Authored-By line names Quo as co-author, with its picture on GitHub, and pull-request links it gives you end with “Made with Quo”. You stay the author and approve every commit, seeing the line first. Off: nothing is added." on={settings.creditQuo} onChange={creditQuo => setCodeSettings({ creditQuo })} />
        <Toggle label="Let Quo push and open pull requests" detail="When you ask, Quo pushes the branch you’re on to its remote and gives you a link to open a pull request on GitHub. You approve every push and see the commits first; it never force-pushes or touches another branch. Off: Quo commits but never pushes." on={settings.allowPush} onChange={allowPush => setCodeSettings({ allowPush })} />
        <Toggle label="Follow the project’s notes" detail="AGENTS.md or CLAUDE.md in the project folder: how to build, test and write code there." on={settings.useNotes} onChange={useNotes => setCodeSettings({ useNotes })} />
        <Toggle label="Start in plan mode" detail="Quo only reads and suggests a plan until you switch Plan off." on={settings.startInPlan} onChange={startInPlan => setCodeSettings({ startInPlan })} />
      </div>
      {hasNativeEngine() && (
        <>
          <div className="sheet-section-title">Offline models</div>
          {offline.length === 0
            ? <p className="note">Code mode also works with an offline model, entirely on this computer. Download one first; bigger models do this much better.</p>
            : (
              <div className="toggle-list">
                {offline.map(model => <Toggle key={model.id} label={model.name} detail={ratingNote(model)} on={isLocalCodeAllowed(model)} onChange={on => setLocalCodeAllowed(model, on)} />)}
              </div>
            )}
        </>
      )}
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
