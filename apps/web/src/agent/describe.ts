import { planToText } from './plan';
import type { AgentStep, ToolResult } from './types';

/**
 * The words the chat shows for each tool call: while it's running ("Reading
 * src/app.ts…") and once it's done ("Read src/app.ts, lines 1-80"). Pure, so they
 * can be tested without a screen.
 */

type Args = Record<string, unknown>;
const text = (value: unknown, fallback = '') => (typeof value === 'string' && value ? value : fallback);
const clip = (value: string, max = 70) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);
const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return clip(url, 40);
  }
};
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
const place = (args: Args) => (args.repo ? `${text(args.repo)}/${text(args.path, '')}`.replace(/\/$/, '') : text(args.path, 'the project'));

export function describeRunning(tool: string, args: Args): string {
  switch (tool) {
    case 'list_directory': return `Looking in ${place(args)}…`;
    case 'read_file': return `Reading ${place(args)}…`;
    case 'find_files': return `Finding ${clip(text(args.pattern))}…`;
    case 'search_text': return `Searching for “${clip(text(args.pattern), 40)}”…`;
    case 'edit_file': return `Waiting for your OK to edit ${text(args.path)}…`;
    case 'write_file': return `Waiting for your OK to write ${text(args.path)}…`;
    case 'run_command': return `Running ${clip(text(args.command), 50)}…`;
    case 'open_in_browser': return `Waiting for your OK to open ${clip(text(args.target), 50)}…`;
    case 'open_project': return args.kind === 'new' ? 'Making a folder for this…' : 'Looking for your project folder…';
    case 'command_output': return `Checking ${text(args.id, 'a background command')}…`;
    case 'stop_command': return `Stopping ${text(args.id, 'a background command')}…`;
    case 'task': return `Helper: ${clip(text(args.description, 'looking into it'), 60)}…`;
    case 'update_plan': return 'Updating the plan…';
    case 'git_commit': return 'Waiting for your OK to commit…';
    case 'open_repo': return `Downloading ${text(args.repo)}…`;
    case 'web_search': return `Searching the web for “${clip(text(args.query), 50)}”…`;
    case 'fetch_url': return `Reading ${host(text(args.url))}…`;
    default: return `Working (${tool})…`;
  }
}

export function describeDone(tool: string, args: Args, result: ToolResult): Pick<AgentStep, 'title' | 'status' | 'detail'> {
  const display = result.display ?? {};
  if (display.denied) {
    return { status: 'declined', title: tool === 'run_command' ? `You declined: ${clip(text(display.command), 60)}${args.background ? ' (background)' : ''}` : tool === 'git_commit' ? 'You declined the commit' : tool === 'open_in_browser' ? `You declined opening ${clip(text(display.target), 50)}` : `You declined the change to ${text(display.path)}` };
  }
  if (!result.ok) return { status: 'failed', title: `${verb(tool, args)} didn’t work: ${clip(result.text.split('\n')[0], 110)}` };
  switch (display.kind) {
    case 'list': return { status: 'done', title: `Looked in ${place(args)} (${plural(Number(display.entries ?? 0), 'item')})` };
    case 'read': return { status: 'done', title: `Read ${place(args)}, lines ${display.from}–${display.to} of ${display.total}` };
    case 'find': return { status: 'done', title: `Found ${plural(Number(display.matches ?? 0), 'file')} matching ${clip(text(display.pattern), 40)}` };
    case 'search': return { status: 'done', title: `Searched for “${clip(text(display.pattern), 40)}”: ${plural(Number(display.matches ?? 0), 'match')} in ${plural(Number(display.files ?? 0), 'file')}` };
    case 'edit': return { status: 'done', title: `Edited ${text(display.path)}  +${display.added} −${display.removed}`, detail: diffOf(display) };
    case 'create': return { status: 'done', title: `Created ${text(display.path)}  +${display.added}`, detail: diffOf(display) };
    case 'opened': return { status: 'done', title: `Opened ${clip(text(display.target), 60)} in your browser` };
    case 'folder': return { status: 'done', title: display.created ? `Made the folder ${text(display.name)}` : `Working in ${text(display.name)}` };
    case 'folder_none': return { status: 'done', title: 'No folder chosen' };
    case 'background': return { status: 'done', title: `Started ${clip(text(display.command), 50)} in the background (${text(display.id)})` };
    case 'background_output': return { status: 'done', title: `${text(display.id)} ${text(display.state)}: ${clip(text(display.command), 40)}`, detail: text(display.output) ? { kind: 'output', body: text(display.output) } : undefined };
    case 'background_stop': return { status: 'done', title: `Stopped ${text(display.id)}: ${clip(text(display.command), 50)}` };
    case 'task': return { status: 'done', title: `Helper done: ${clip(text(display.description), 60)} (${plural(Number(display.steps ?? 0), 'step')})`, detail: text(display.report) ? { kind: 'output', body: text(display.report) } : undefined };
    case 'plan': {
      const items = Array.isArray(display.items) ? display.items as { step?: string; status?: string }[] : [];
      const done = items.filter(item => item.status === 'completed').length;
      return { status: 'done', title: `Plan: ${done} of ${plural(items.length, 'step')} done`, detail: { kind: 'plan', body: planToText(items.map(item => ({ step: text(item.step), status: item.status === 'completed' || item.status === 'in_progress' ? item.status : 'pending' }))) } };
    }
    case 'commit': return { status: 'done', title: `Committed ${plural(Array.isArray(display.files) ? display.files.length : 0, 'file')} (${text(display.hash)})`, detail: text(display.message) ? { kind: 'output', body: text(display.message) } : undefined };
    case 'repo': return { status: 'done', title: `Opened ${text(display.repo)}` };
    case 'web_search': {
      const results = Array.isArray(display.results) ? display.results as { title?: string; url?: string }[] : [];
      return { status: 'done', title: `Searched the web for “${clip(text(display.query), 40)}”: ${plural(results.length, 'result')}`, detail: results.length ? { kind: 'output', body: results.map(r => `${text(r.title)}\n${text(r.url)}`).join('\n\n') } : undefined };
    }
    case 'fetch': return { status: 'done', title: `Read ${clip(text(display.title, host(text(display.url))), 70)}`, detail: text(display.url) ? { kind: 'output', body: text(display.url) } : undefined };
    case 'command': {
      const code = display.aborted ? 'stopped' : display.timedOut ? 'timed out' : display.exitCode === 0 ? 'OK' : `exit ${display.exitCode}`;
      return {
        status: display.exitCode === 0 ? 'done' : 'failed',
        title: `Ran ${clip(text(display.command), 60)} (${code})`,
        detail: text(display.output) ? { kind: 'output', body: text(display.output) } : undefined,
      };
    }
    default: return { status: 'done', title: verb(tool, args) };
  }
}

const diffOf = (display: Record<string, unknown>): AgentStep['detail'] => (text(display.diff) ? { kind: 'diff', body: text(display.diff) } : undefined);

function verb(tool: string, args: Args): string {
  switch (tool) {
    case 'list_directory': return `Looking in ${place(args)}`;
    case 'read_file': return `Reading ${place(args)}`;
    case 'find_files': return 'Finding files';
    case 'search_text': return 'Searching';
    case 'edit_file': return `Editing ${text(args.path)}`;
    case 'write_file': return `Writing ${text(args.path)}`;
    case 'run_command': return `Running ${clip(text(args.command), 50)}`;
    case 'open_in_browser': return `Opening ${clip(text(args.target), 50)}`;
    case 'open_project': return args.kind === 'new' ? 'Making a folder' : 'Opening your project folder';
    case 'command_output': return `Checking ${text(args.id, 'a background command')}`;
    case 'stop_command': return `Stopping ${text(args.id, 'a background command')}`;
    case 'task': return `Helper: ${clip(text(args.description, 'looking into it'), 60)}`;
    case 'update_plan': return 'Updating the plan';
    case 'git_commit': return 'Committing';
    case 'open_repo': return `Opening ${text(args.repo)}`;
    case 'web_search': return 'Searching the web';
    case 'fetch_url': return `Reading ${host(text(args.url))}`;
    default: return tool;
  }
}
