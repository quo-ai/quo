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

/** A diff with the added and removed lines coloured; anything else is plain text. */
function Detail({ detail }: { detail: NonNullable<AgentStep['detail']> }) {
  if (detail.kind === 'output') return <pre className="step-pre">{detail.body}</pre>;
  return (
    <pre className="step-pre">
      {detail.body.split('\n').map((line, index) => (
        <span key={index} className={line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : undefined}>{line}{'\n'}</span>
      ))}
    </pre>
  );
}

/** What the coding agent did during a reply, one line each; open one for the diff or the output. */
export function AgentSteps({ steps }: { steps: AgentStep[] }) {
  return (
    <ul className="steps" aria-label="What Quo Code did">
      {steps.map(step => {
        const more = step.detail || step.text;
        return (
          <li key={step.id} className={`step ${step.status}`}>
            {more ? (
              <details>
                <summary><StepIcon step={step} /> <span className="step-title">{step.title}</span> <ChevronRight size={13} className="step-chev" /></summary>
                {step.text && <p className="step-text">{step.text}</p>}
                {step.detail && <Detail detail={step.detail} />}
              </details>
            ) : (
              <div className="step-row"><StepIcon step={step} /> <span className="step-title">{step.title}</span></div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
