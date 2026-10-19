import { describe, expect, it } from 'vitest';
import { runSubagent, SUBAGENT_STEPS } from '../subagent';
import type { AgentMessage, StepReply, ToolResult } from '../types';

const reply = (patch: Partial<StepReply> = {}): StepReply => ({ content: '', toolCalls: [], finish: 'stop', charged: 0.25, balance: 5, ...patch });
const call = (id: string, name: string, args: unknown) => ({ id, name, arguments: JSON.stringify(args) });

function helper(replies: StepReply[]) {
  const seen: AgentMessage[][] = [];
  const ran: string[] = [];
  let cost = 0;
  const controller = new AbortController();
  return {
    seen, ran, controller,
    cost: () => cost,
    deps: {
      signal: controller.signal,
      askModel: async (messages: AgentMessage[]) => (seen.push(messages), replies[seen.length - 1] ?? reply({ content: 'done' })),
      runTool: async (name: string): Promise<ToolResult> => (ran.push(name), { ok: true, text: `${name} ok`, display: { kind: 'read' } }),
      onCost: (charged: number) => { cost += charged; },
    },
  };
}

describe('the task tool’s helper', () => {
  it('starts from nothing but the question, reads, and hands back its report', async () => {
    const h = helper([reply({ toolCalls: [call('a', 'search_text', { pattern: 'x' }), call('b', 'read_file', { path: 'a.js' })], finish: 'tool_calls' }), reply({ content: 'It is in a.js:3.' })]);
    const result = await runSubagent({ description: 'find x', prompt: 'Where is x defined?' }, h.deps);
    expect(h.seen[0]).toEqual([{ role: 'user', content: 'Where is x defined?' }]);
    expect(h.ran).toEqual(['search_text', 'read_file']);
    expect(result).toMatchObject({ ok: true, text: 'It is in a.js:3.', display: { kind: 'task', description: 'find x', steps: 2 } });
    expect(h.cost()).toBeCloseTo(0.5);
  });

  it('can only read: any other tool, including starting another helper, is refused without running', async () => {
    const h = helper([
      reply({ toolCalls: [call('a', 'edit_file', {}), call('b', 'run_command', { command: 'ls' }), call('c', 'task', { prompt: 'again' }), call('d', 'git_commit', {})], finish: 'tool_calls' }),
      reply({ content: 'Could not.' }),
    ]);
    await runSubagent({ description: 'try', prompt: 'Do things' }, h.deps);
    expect(h.ran).toEqual([]);
    const answers = h.seen[1].filter(m => m.role === 'tool').map(m => m.content);
    expect(answers).toHaveLength(4);
    answers.forEach(text => expect(text).toMatch(/can only read/));
  });

  it('refuses an empty or huge question, and caps its steps and its report', async () => {
    const h = helper([]);
    expect((await runSubagent({ description: 'x', prompt: '   ' }, h.deps)).ok).toBe(false);
    expect((await runSubagent({ description: 'x', prompt: 'a'.repeat(4001) }, h.deps)).ok).toBe(false);
    expect(h.seen).toEqual([]);
    const endless = helper(Array.from({ length: SUBAGENT_STEPS + 5 }, (_, i) => reply({ toolCalls: [call(`c${i}`, 'read_file', { path: `f${i}.js` })], finish: 'tool_calls' })));
    const limited = await runSubagent({ description: 'x', prompt: 'Look' }, endless.deps);
    expect(endless.seen).toHaveLength(SUBAGENT_STEPS);
    expect(limited.text).toMatch(/ran out of steps/);
    const wordy = helper([reply({ content: 'z'.repeat(20_000) })]);
    expect((await runSubagent({ description: 'x', prompt: 'Look' }, wordy.deps)).text.length).toBeLessThan(6100);
  });

  it('stops when the person stops', async () => {
    const h = helper([reply({ toolCalls: [call('a', 'read_file', { path: 'a' })], finish: 'tool_calls' })]);
    h.deps.runTool = async () => (h.controller.abort(), { ok: true, text: 'late' });
    expect((await runSubagent({ description: 'x', prompt: 'Look' }, h.deps)).ok).toBe(false);
  });
});
