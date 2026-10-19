import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { exactCommand, matchCommands, type Command } from '../../chat/commands';
import type { AgentStep } from '../../agent/types';
import { foldSummary } from '../AgentSteps';
import { textOf } from '../Markdown';
import { buildCommands, type CommandActions, type CommandState } from '../chat/useCommands';

const run = () => {};
const list: Command[] = [
  { name: 'new', hint: 'n', run }, { name: 'plan', hint: 'p', run }, { name: 'summarise', aliases: ['summarize', 'compact'], hint: 's', run }, { name: 'code', hint: 'c', run }, { name: 'copy', hint: 'cp', run },
];

describe('slash commands', () => {
  it('lists what a half-typed command could mean: names first, then aliases', () => {
    expect(matchCommands('/', list).map(c => c.name)).toEqual(['new', 'plan', 'summarise', 'code', 'copy']);
    expect(matchCommands('/co', list).map(c => c.name)).toEqual(['code', 'copy', 'summarise']);
    expect(matchCommands('/PL', list).map(c => c.name)).toEqual(['plan']);
    expect(matchCommands('/sum', list).map(c => c.name)).toEqual(['summarise']);
    expect(matchCommands('/zzz', list)).toEqual([]);
  });

  it('is only a command at the start of the box, with nothing after it', () => {
    for (const input of ['', 'hello', 'look at /plan', '/plan now', '/ plan', '//', '/plan\nmore']) expect(matchCommands(input, list), JSON.stringify(input)).toEqual([]);
  });

  it('knows a whole command, by name or alias', () => {
    expect(exactCommand('/plan', list)?.name).toBe('plan');
    expect(exactCommand('  /Plan  ', list)?.name).toBe('plan');
    expect(exactCommand('/compact', list)?.name).toBe('summarise');
    expect(exactCommand('/plan now', list)).toBeNull();
    expect(exactCommand('/unknown', list)).toBeNull();
    expect(exactCommand('plan', list)).toBeNull();
  });
});

describe('which commands apply', () => {
  const state: CommandState = { busy: false, hasUserMessage: false, hasReply: false, codeAvailable: false, codeOn: false, plan: false, webAvailable: false, webOn: false, canThink: false, thinking: 'Auto', canSummarize: false, canUndo: false };
  const actions = new Proxy({}, { get: () => run }) as CommandActions;
  const names = (patch: Partial<CommandState>) => buildCommands({ ...state, ...patch }, actions).map(c => c.name);

  it('always has the basics, and nothing that has nothing to act on', () => {
    expect(names({})).toEqual(['new', 'model', 'keys']);
  });

  it('adds commands as they become possible', () => {
    expect(names({ hasUserMessage: true, hasReply: true })).toEqual(['new', 'retry', 'copy', 'model', 'keys']);
    expect(names({ canSummarize: true })).toContain('summarise');
    expect(names({ codeAvailable: true })).toContain('code');
    expect(names({ codeAvailable: true, codeOn: true })).toEqual(['new', 'code', 'plan', 'folder', 'model', 'keys']);
    expect(names({ canUndo: true })).toContain('undo');
    expect(names({ webAvailable: true })).toContain('web');
    expect(names({ canThink: true })).toContain('think');
  });

  it('while a reply is being written, offers to stop it, and nothing that would start something', () => {
    const busy = names({ busy: true, hasUserMessage: true, canSummarize: true, codeAvailable: true, codeOn: true });
    expect(busy).toContain('stop');
    for (const name of ['retry', 'summarise', 'code', 'folder']) expect(busy).not.toContain(name);
  });

  it('says what a toggle is now', () => {
    const hint = (patch: Partial<CommandState>, name: string) => buildCommands({ ...state, ...patch }, actions).find(c => c.name === name)?.hint;
    expect(hint({ codeOn: true, plan: true }, 'plan')).toMatch(/now on/);
    expect(hint({ webAvailable: true, webOn: false }, 'web')).toMatch(/now off/);
  });
});

describe('steps and code in the chat', () => {
  const step = (tool: string): AgentStep => ({ id: Math.random().toString(), tool, title: tool, status: 'done' });

  it('sums up the steps that were folded away', () => {
    const steps = [...Array(5).fill('read_file'), 'search_text', 'edit_file', 'edit_file', 'run_command', 'web_search'].map(step);
    expect(foldSummary(steps)).toBe('10 earlier steps: 6 looks, 2 changes, 1 command, 1 web lookup');
    expect(foldSummary([step('read_file')])).toBe('1 earlier step: 1 look');
    expect(foldSummary([step('mystery')])).toBe('1 earlier step');
  });

  it('finds the text of a code block to copy', () => {
    expect(textOf(createElement('code', { className: 'language-js' }, 'const a = 1;\n', createElement('span', null, 'b'), ['c', 2]))).toBe('const a = 1;\nbc2');
    expect(textOf(null)).toBe('');
  });
});
