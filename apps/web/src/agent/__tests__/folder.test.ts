import { describe, expect, it } from 'vitest';
import { openProjectTool, type FolderOpener } from '../folder';
import type { CodeSession } from '../session';

const session = (name = 'my-app', notes: string | null = null) => ({ project: { id: 'p', name }, info: { hint: '~/work', instructions: notes ? { file: notes, text: 'x' } : null } }) as unknown as CodeSession;
const opener = (result: { session: CodeSession | null; note: string }, calls: unknown[][] = []): FolderOpener => ({ open: async (...args) => (calls.push(args), result) });

describe('the model asks for a folder', () => {
  it('opens one, tells the model what it can do now, and hands back the session', async () => {
    const calls: unknown[][] = [];
    const s = session('my-app', 'AGENTS.md');
    const { result, session: got } = await openProjectTool({ kind: 'existing' }, null, opener({ session: s, note: '' }, calls));
    expect(got).toBe(s);
    expect(calls).toEqual([['existing', undefined]]);
    expect(result.ok).toBe(true);
    expect(result.text).toMatch(/Now working in "my-app" \(~\/work\)\./);
    expect(result.text).toMatch(/approves every change and command/);
    expect(result.text).toMatch(/notes in AGENTS\.md/);
    expect(result.display).toMatchObject({ kind: 'folder', name: 'my-app', created: false });
  });

  it('asks for a new folder, with the name it was given, shortened', async () => {
    const calls: unknown[][] = [];
    const { result } = await openProjectTool({ kind: 'new', name: 'x'.repeat(500) }, null, opener({ session: session('todo-app'), note: '' }, calls));
    expect((calls[0][1] as string).length).toBe(80);
    expect(calls[0][0]).toBe('new');
    expect(result.text).toContain('a new empty folder');
    expect(result.display).toMatchObject({ created: true });
  });

  it('treats anything but "new" as the person’s own project', async () => {
    const calls: unknown[][] = [];
    for (const kind of [undefined, 'whatever', 7, null]) await openProjectTool({ kind }, null, opener({ session: null, note: '' }, calls));
    expect(calls.every(call => call[0] === 'existing')).toBe(true);
  });

  it('reads a refusal as an answer, not a failure, and carries the reason to the model', async () => {
    const { result, session: got } = await openProjectTool({ kind: 'existing' }, null, opener({ session: null, note: 'The person chose no folder, so you can’t use their files.' }));
    expect(got).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.text).toContain('chose no folder');
    expect(result.display).toEqual({ kind: 'folder_none' });
    expect((await openProjectTool({ kind: 'new' }, null, opener({ session: null, note: '' }))).result.text).toMatch(/Carry on without/);
  });

  it('does nothing if a folder is already open', async () => {
    const calls: unknown[][] = [];
    const open = session('already');
    const { result, session: got } = await openProjectTool({ kind: 'new' }, open, opener({ session: session('other'), note: '' }, calls));
    expect(got).toBe(open);
    expect(calls).toEqual([]);
    expect(result.text).toContain('Already working in already');
  });
});
