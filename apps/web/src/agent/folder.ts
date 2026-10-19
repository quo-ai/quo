import type { CodeSession } from './session';
import type { ToolResult } from './types';

/**
 * The open_project tool: the model decides, from the whole message, that the request needs the person's files, and asks
 * for a folder. The app does what it always did to get one (the person's own project folder from the system dialog, the
 * folder used last, or a new empty one under Documents/Quo Projects): nothing here picks a path, and a refusal is just
 * an answer the model reads and carries on from.
 */

export interface FolderOpener {
  open: (kind: 'existing' | 'new', name?: string) => Promise<{ session: CodeSession | null; note: string }>;
}

export async function openProjectTool(args: Record<string, unknown>, current: CodeSession | null, opener: FolderOpener): Promise<{ result: ToolResult; session: CodeSession | null }> {
  if (current) return { session: current, result: { ok: true, text: `Already working in ${current.project.name}. Use the project tools.`, display: { kind: 'folder', name: current.project.name } } };
  const kind = args.kind === 'new' ? 'new' : 'existing';
  const name = typeof args.name === 'string' ? args.name.slice(0, 80) : undefined;
  const { session, note } = await opener.open(kind, name);
  if (!session) return { session: null, result: { ok: true, text: note || 'The person chose no folder, so you can’t use their files. Carry on without, and say what you can still do.', display: { kind: 'folder_none' } } };
  const notes = session.info.instructions?.file ? ` The project has notes in ${session.info.instructions.file}; they come with the files.` : '';
  return {
    session,
    result: {
      ok: true,
      text: `Now working in "${session.project.name}"${session.info.hint ? ` (${session.info.hint})` : ''}${kind === 'new' ? ', a new empty folder' : ''}. You can list, read and search files, change them and run commands; the person approves every change and command.${notes}`,
      display: { kind: 'folder', name: session.project.name, created: kind === 'new' },
    },
  };
}
