import { describe, expect, it } from 'vitest';
import { runAgent, type AgentDeps } from '../loop';
import { SUMMARY_MARK, originalGoal, previousReport, splitForSummary, transcriptOf, withSummary } from '../summarize';
import type { AgentMessage, StepReply } from '../types';

const call = (id: string, name = 'read_file', args = '{"path":"a.ts"}') => ({ id, type: 'function' as const, function: { name, arguments: args } });
/** A person's message, then `pairs` calls with their results. */
const session = (pairs: number, size = 50): AgentMessage[] => [
  { role: 'user', content: 'Fix the login bug' },
  ...Array.from({ length: pairs }, (_, i): AgentMessage[] => [
    { role: 'assistant', content: i === 0 ? 'Looking.' : '', tool_calls: [call(`c${i}`, 'read_file', `{"path":"f${i}.ts"}`)] },
    { role: 'tool', tool_call_id: `c${i}`, content: `file ${i} `.padEnd(size, 'x') },
  ]).flat(),
];

describe('writing up the middle of a long session', () => {
  it('keeps the person’s message and the newest steps, and finds nothing to do for a short session', () => {
    expect(splitForSummary(session(3))).toBeNull();
    const split = splitForSummary(session(10))!;
    expect(split.userIndex).toBe(0);
    expect(split.middle[0].role).toBe('assistant');
    const kept = session(10).slice(split.tailStart);
    expect(kept[0].role).not.toBe('tool'); // a kept result always has its call
    expect(split.tailStart + kept.length).toBe(21);
  });

  it('turns the middle into plain text with shortened results, and carries an earlier report forward', () => {
    const messages = session(10, 3000);
    const split = splitForSummary(messages)!;
    const text = transcriptOf('Fix the login bug', 'Goal: login. Done: read f0.', split.middle);
    expect(text).toMatch(/The person asked: Fix the login bug/);
    expect(text).toMatch(/Progress already written up before these steps:\nGoal: login\. Done: read f0\./);
    expect(text).toMatch(/Agent called read_file \{"path":"f1\.ts"\}/);
    expect(text).toMatch(/Result of read_file: file 1 x+…/);
    expect(text.length).toBeLessThan(split.middle.length * 1100);
    expect(text).not.toMatch(/x{800}/);
  });

  it('replaces the middle with the report inside the person’s message, and replaces its own earlier report next time', () => {
    const messages = session(10);
    const split = splitForSummary(messages)!;
    const once = withSummary(messages, split, 'Goal: login.\nDone: read f0-f3.');
    expect(once).toHaveLength(1 + (messages.length - split.tailStart));
    expect(once[0]).toMatchObject({ role: 'user' });
    expect(once[0].content).toBe(`Fix the login bug${SUMMARY_MARK}Goal: login.\nDone: read f0-f3.`);
    expect(originalGoal(once[0].content)).toBe('Fix the login bug');
    expect(previousReport(once[0].content)).toBe('Goal: login.\nDone: read f0-f3.');
    const grown = [...once, ...session(10).slice(1)];
    const again = withSummary(grown, splitForSummary(grown)!, 'Newer report');
    expect(again[0].content).toBe(`Fix the login bug${SUMMARY_MARK}Newer report`);
  });

  it('caps a runaway report', () => {
    const messages = session(10);
    expect(withSummary(messages, splitForSummary(messages)!, 'z'.repeat(20_000))[0].content.length).toBeLessThan(4200);
  });
});

describe('the loop and long sessions', () => {
  const reply = (patch: Partial<StepReply> = {}): StepReply => ({ content: '', toolCalls: [], finish: 'stop', charged: 0, balance: null, ...patch });
  const reads = (n: number) => Array.from({ length: n }, (_, i) => reply({ toolCalls: [{ id: `r${i}`, name: 'read_file', arguments: `{"path":"f${i}.ts"}` }], finish: 'tool_calls' }));
  function run(summarize: AgentDeps['summarize'], replies: StepReply[], contextChars = 6000) {
    const controller = new AbortController();
    const asked: AgentMessage[][] = [];
    const deps: AgentDeps = {
      signal: controller.signal,
      contextChars,
      summarize,
      askModel: async messages => (asked.push(messages), replies[asked.length - 1] ?? reply({ content: 'Done.' })),
      runTool: async () => ({ ok: true, text: 'y'.repeat(900), display: { kind: 'read' } }),
      onUpdate: () => {},
    };
    return { asked, controller, outcome: runAgent([{ role: 'user', content: 'Fix the login bug' }], deps) };
  }

  it('writes the middle up once the conversation nears the window, then goes on from the report', async () => {
    const seen: string[] = [];
    const { asked, outcome } = run(async transcript => (seen.push(transcript), 'Goal: login. Done: read f0-f5.'), [...reads(14), reply({ content: 'Fixed.' })]);
    const result = await outcome;
    expect(result.text).toBe('Fixed.');
    expect(seen.length).toBeGreaterThan(0);
    const afterwards = asked.find(messages => messages[0].content.includes('Progress so far'))!;
    expect(afterwards).toBeDefined();
    expect(afterwards[0].content).toMatch(/^Fix the login bug/);
    expect(afterwards.length).toBeLessThan(asked[asked.length - 1].length + 20);
    expect(result.steps.some(step => step.tool === 'summary' && step.status === 'done')).toBe(true);
  });

  it('falls back to dropping old output when the report fails, and does not hammer the model', async () => {
    let tries = 0;
    const { outcome } = run(async () => { tries++; throw new Error('upstream'); }, [...reads(14), reply({ content: 'Fixed.' })]);
    const result = await outcome;
    expect(result.text).toBe('Fixed.');
    expect(tries).toBeLessThanOrEqual(4);
    expect(result.steps.some(step => step.tool === 'summary' && step.status === 'failed')).toBe(true);
  });

  it('does nothing for a short session, or without a summariser', async () => {
    let called = false;
    const short = await run(async () => { called = true; return 'x'; }, [...reads(2), reply({ content: 'ok' })], 100_000).outcome;
    expect(called).toBe(false);
    expect(short.steps.every(step => step.tool !== 'summary')).toBe(true);
    const none = await run(undefined, [...reads(14), reply({ content: 'ok' })]).outcome;
    expect(none.steps.every(step => step.tool !== 'summary')).toBe(true);
  });

  it('stops when the person stops while it is writing up', async () => {
    const holder: { abort?: () => void } = {};
    const { controller, outcome } = run(async () => { holder.abort?.(); await new Promise(resolve => setTimeout(resolve, 5)); return 'late'; }, [...reads(14), reply({ content: 'ok' })]);
    holder.abort = () => controller.abort();
    expect((await outcome).stopped).toBe(true);
  });
});
