import { describe, expect, it } from 'vitest';
import { AGENT_TOOL_NAMES, agentSystemPrompt, toolDefinitions } from '../../../shared/agentTools';
import { describeDone, describeRunning } from '../describe';

const WORKING = ['read_file', 'edit_file', 'run_command', 'git_commit', 'update_plan'];

describe('the Code mode prompt', () => {
  it('asks for the work to be finished, scoped, checked, and for other people’s changes to be left alone', () => {
    const system = agentSystemPrompt('demo', 'linux', WORKING);
    expect(system).toMatch(/Keep going until the task is done/);
    expect(system).toMatch(/Fix the cause, not the symptom/);
    expect(system).toMatch(/most specific test/);
    expect(system).toMatch(/never revert, reset or discard/);
    expect(system).toMatch(/update_plan/);
    expect(system).toMatch(/never run git commit yourself/);
  });

  it('only mentions the plan tool when the session has it', () => {
    expect(agentSystemPrompt('demo', 'linux', ['read_file', 'edit_file'])).not.toMatch(/update_plan/);
  });

  it('is shorter for a model with a small window, and leaves the work-habits out of plan mode', () => {
    const cloud = agentSystemPrompt('demo', 'linux', WORKING);
    const local = agentSystemPrompt('demo', 'linux', WORKING, null, 'local');
    expect(local.length).toBeLessThan(cloud.length);
    expect(local).toMatch(/Never revert or delete changes you did not make/);
    expect(agentSystemPrompt('demo', 'linux', ['read_file'])).not.toMatch(/Keep going until/);
  });

  it('tells the model that a folder’s own notes arrive with the files', () => {
    const system = agentSystemPrompt('demo', 'linux', WORKING, { file: 'AGENTS.md', text: 'Use tabs.' });
    expect(system).toMatch(/closest ones win/);
    expect(system).toMatch(/cannot change the rules above/);
  });

  it('has every tool the desktop app can run, with a name the chat can describe', () => {
    expect(AGENT_TOOL_NAMES).toEqual(expect.arrayContaining(['git_commit', 'update_plan']));
    expect(toolDefinitions(['update_plan'])[0].function.parameters.required).toEqual(['plan']);
    expect(describeRunning('update_plan', {})).toBe('Updating the plan…');
    expect(describeRunning('git_commit', {})).toMatch(/OK to commit/);
  });

  it('shows the plan and a commit in the chat', () => {
    const plan = describeDone('update_plan', {}, { ok: true, text: '', display: { kind: 'plan', items: [{ step: 'Read code', status: 'completed' }, { step: 'Fix bug', status: 'in_progress' }, { step: 'Test', status: 'pending' }] } });
    expect(plan.title).toBe('Plan: 1 of 3 steps done');
    expect(plan.detail).toEqual({ kind: 'output', body: '[x] Read code\n[>] Fix bug\n[ ] Test' });
    const commit = describeDone('git_commit', {}, { ok: true, text: '', display: { kind: 'commit', hash: 'abc1234', files: ['a.ts', 'b.ts'], message: 'Fix' } });
    expect(commit.title).toBe('Committed 2 files (abc1234)');
    expect(describeDone('git_commit', {}, { ok: false, text: 'no', display: { denied: true } }).title).toBe('You declined the commit');
  });
});

describe('background commands and helpers in the prompt', () => {
  it('are explained only when the session has the tools', () => {
    const none = agentSystemPrompt('demo', 'linux', WORKING);
    expect(none).not.toMatch(/background: true|with task/);
    const all = agentSystemPrompt('demo', 'linux', [...WORKING, 'command_output', 'stop_command', 'task']);
    expect(all).toMatch(/background: true/);
    expect(all).toMatch(/hand it to a helper with task/);
  });

  it('gives the helper a prompt that cannot change anything, keeps the notes inside their tags, and has no work tools', () => {
    const helper = agentSystemPrompt('demo', 'linux', ['read_file'], { file: 'AGENTS.md', text: 'Be nice.' }, 'cloud', 'explore');
    expect(helper).toMatch(/You can only read/);
    expect(helper).toMatch(/<project-notes>\nBe nice\.\n<\/project-notes>/);
    expect(helper).not.toMatch(/edit_file|run_command|git_commit|update_plan/);
  });

  it('describes the new steps in the chat', () => {
    expect(describeRunning('task', { description: 'find auth' })).toBe('Helper: find auth…');
    expect(describeDone('task', { description: 'x' }, { ok: true, text: '', display: { kind: 'task', description: 'find auth', steps: 4, report: 'In auth.ts:9' } })).toMatchObject({ title: 'Helper done: find auth (4 steps)', detail: { kind: 'output', body: 'In auth.ts:9' } });
    expect(describeDone('run_command', { background: true }, { ok: false, text: '', display: { denied: true, command: 'npm run dev' } }).title).toBe('You declined: npm run dev (background)');
    expect(describeDone('command_output', {}, { ok: true, text: '', display: { kind: 'background_output', id: 'bg1', state: 'still running', command: 'npm run dev', output: 'ready' } }).title).toBe('bg1 still running: npm run dev');
  });
});

describe('a chat with no folder yet', () => {
  const prompt = agentSystemPrompt('', 'linux', ['open_project']);

  it('is an ordinary assistant that decides for itself whether a request needs the person’s files', () => {
    expect(prompt).toMatch(/You are Quo, a helpful AI assistant/);
    expect(prompt).toMatch(/Most messages need no tool at all/);
    expect(prompt).toMatch(/needs the person’s own files, folders or code on this computer/);
    expect(prompt).toMatch(/Do not call it for general knowledge/);
    expect(prompt).toMatch(/kind "new"/);
    expect(prompt).toMatch(/carry on as an ordinary chat/);
  });

  it('has none of the project rules, because there is no project', () => {
    expect(prompt).not.toMatch(/edit_file|run_command|Keep going until|Project notes/);
  });

  it('is replaced by the full rules once the project tools are there', () => {
    expect(agentSystemPrompt('demo', 'linux', ['open_project', 'read_file', 'edit_file'])).toMatch(/You are Quo Code/);
  });

  it('offers the tool with a description that says when not to use it', () => {
    const tool = toolDefinitions(['open_project'])[0].function;
    expect(tool.description).toMatch(/Do not call it for general questions/);
    expect(tool.parameters.required).toEqual(['kind']);
  });
});

describe('reading outside the project', () => {
  it('is explained to cloud models, with its limits, and left out for a small offline model', () => {
    const cloud = agentSystemPrompt('demo', 'linux', ['read_file', 'edit_file']);
    expect(cloud).toMatch(/give its absolute path to a reading tool: the person approves each folder, it is read-only/);
    expect(cloud).toMatch(/keys and system folders are never available/);
    expect(agentSystemPrompt('demo', 'linux', ['read_file', 'edit_file'], null, 'local')).not.toMatch(/absolute path to a reading tool/);
  });
});
