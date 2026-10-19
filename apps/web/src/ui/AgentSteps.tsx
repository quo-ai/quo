import { AlertCircle, Ban, ChevronRight, FilePlus, FileText, Folder, Globe, Link2, Loader2, Pencil, Search, Square, Terminal, Download, Check } from 'lucide-react';
import type { AgentStep } from '../agent/types';

const ICONS: Record<string, typeof FileText> = {
  list_directory: Folder,
  read_file: FileText,
  find_files: Search,
  search_text: Search,
  edit_file: Pencil,
  write_file: FilePlus,
  run_command: Terminal,
  open_project: Folder,
  command_output: Terminal,
  stop_command: Terminal,
  open_repo: Download,
  web_search: Globe,
  fetch_url: Link2,
};

function StepIcon({ step }: { step: AgentStep }) {
  if (step.status === 'running') return <Loader2 size={14} className="spin" />;
  if (step.status === 'failed') return <AlertCircle size={14} />;
  if (step.status === 'declined') return <Ban size={14} />;
  if (step.status === 'stopped') return <Square size={12} />;
  const Icon = ICONS[step.tool] ?? Check;
  return <Icon size={14} />;
}

/** A diff with the added and removed lines coloured, command output as terminal text; anything else is plain. */
function Detail({ detail }: { detail: NonNullable<AgentStep['detail']> }) {
  if (detail.kind === 'output') return <pre className="step-pre output">{detail.body}</pre>;
  return (
    <pre className="step-pre">
      {detail.body.split('\n').map((line, index) => (
        <span key={index} className={line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : undefined}>{line}{'\n'}</span>
      ))}
    </pre>
  );
}

/** "Edited src/app.ts  +3 −1": the counts at the end become small badges. */
function Title({ title }: { title: string }) {
  const counts = /^(.*?)\s{2}(\+\d+)(?:\s(−\d+))?$/.exec(title);
  if (!counts) return <span className="step-title">{title}</span>;
  return (
    <>
      <span className="step-title">{counts[1]}</span>
      <span className="diffstat"><span className="add">{counts[2]}</span>{counts[3] && <span className="del">{counts[3]}</span>}</span>
    </>
  );
}

function Row({ step }: { step: AgentStep }) {
  const more = step.detail || step.text;
  return (
    <li className={`step ${step.status}`}>
      {more ? (
        <details>
          <summary><StepIcon step={step} /> <Title title={step.title} /> <ChevronRight size={13} className="step-chev" /></summary>
          {step.text && <p className="step-text">{step.text}</p>}
          {step.detail && <Detail detail={step.detail} />}
        </details>
      ) : (
        <div className="step-row"><StepIcon step={step} /> <Title title={step.title} /></div>
      )}
    </li>
  );
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const KINDS: [string[], string, string?][] = [
  [['list_directory', 'read_file', 'find_files', 'search_text'], 'look'],
  [['edit_file', 'write_file'], 'change'],
  [['run_command', 'command_output', 'stop_command'], 'command'],
  [['task'], 'helper'],
  [['git_commit'], 'commit'],
  [['update_plan'], 'plan update'],
  [['web_search', 'fetch_url'], 'web lookup'],
];

/** "9 earlier steps: 6 looks, 2 changes, 1 command". */
export function foldSummary(steps: AgentStep[]): string {
  const parts = KINDS.map(([tools, word]) => ({ count: steps.filter(step => tools.includes(step.tool)).length, word })).filter(part => part.count).map(part => plural(part.count, part.word));
  return `${plural(steps.length, 'earlier step')}${parts.length ? `: ${parts.join(', ')}` : ''}`;
}

/** Past this many steps, the older ones fold away and the latest few stay in view. */
const FOLD_AFTER = 6;
const KEEP = 3;

/** What the coding agent did during a reply, one line each; open one for the diff or the output. */
export function AgentSteps({ steps, live = false }: { steps: AgentStep[]; live?: boolean }) {
  const folded = steps.length > FOLD_AFTER ? steps.slice(0, steps.length - KEEP) : [];
  return (
    <ul className={`steps${live ? ' live' : ''}`} aria-label="What Quo Code did">
      {folded.length > 0 && (
        <li className="step-fold">
          <details>
            <summary><ChevronRight size={13} className="step-chev-start" /> {foldSummary(folded)}</summary>
            <ul className="steps">{folded.map(step => <Row key={step.id} step={step} />)}</ul>
          </details>
        </li>
      )}
      {steps.slice(folded.length).map(step => <Row key={step.id} step={step} />)}
    </ul>
  );
}
