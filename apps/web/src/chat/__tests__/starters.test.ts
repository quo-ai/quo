import { describe, expect, it } from 'vitest';
import { greeting, pickStarters, POOLS } from '../starters';
import { workingLabel } from '../working';
import { formatElapsed } from '../../ui/elapsed';
import { planFromText, planToText } from '../../agent/plan';

describe('what an empty chat suggests', () => {
  it('gives four different starters that fit where the person is', () => {
    const chat = pickStarters('chat', 'a');
    expect(chat).toHaveLength(4);
    expect(new Set(chat.map(s => s.title)).size).toBe(4);
    expect(chat.every(s => POOLS.EVERYDAY.includes(s))).toBe(true);
    expect(pickStarters('project', 'a').every(s => POOLS.PROJECT.includes(s))).toBe(true);
    const mixed = pickStarters('mixed', 'a');
    expect(mixed.filter(s => POOLS.BUILD.includes(s))).toHaveLength(2);
    expect(mixed.filter(s => POOLS.EVERYDAY.includes(s))).toHaveLength(2);
  });

  it('stays the same for the same chat and day, and varies between them', () => {
    expect(pickStarters('chat', 'chat-1:2026-10-19')).toEqual(pickStarters('chat', 'chat-1:2026-10-19'));
    const sets = new Set(Array.from({ length: 40 }, (_, i) => pickStarters('chat', `chat-${i}`).map(s => s.title).join('|')));
    expect(sets.size).toBeGreaterThan(20);
  });

  it('has real prompts, and never health or medical topics', () => {
    for (const s of [...POOLS.EVERYDAY, ...POOLS.PROJECT, ...POOLS.BUILD]) {
      expect(s.prompt.length).toBeGreaterThan(30);
      expect(`${s.title} ${s.detail} ${s.prompt}`).not.toMatch(/health|medical|medicine|diet|symptom|doctor|therapy|illness|disease|weight loss|calorie/i);
    }
  });

  it('is limited by the pool, and a project never gets everyday ideas', () => {
    expect(pickStarters('project', 'x', 99)).toHaveLength(POOLS.PROJECT.length);
    expect(pickStarters('project', 'x').some(s => POOLS.EVERYDAY.includes(s))).toBe(false);
  });
});

describe('the greeting', () => {
  const at = (hour: number) => new Date(2026, 9, 19, hour, 30);
  it('follows the time of day', () => {
    expect(greeting(at(3), 's', false)).toMatch(/^(Still up\?|Burning the midnight oil\?) What’s on your mind\?$/);
    expect(greeting(at(9), 's', false)).toMatch(/^(Good morning\.|Morning\.) What’s on your mind\?$/);
    expect(greeting(at(14), 's', false)).toMatch(/afternoon|Afternoon/i);
    expect(greeting(at(21), 's', false)).toMatch(/evening|Evening/i);
  });
  it('asks about the work inside a project, and is steady for a seed', () => {
    expect(greeting(at(9), 's', true)).toMatch(/^(What are we working on\?|What shall we build\?|Where shall we start\?)$/);
    expect(greeting(at(9), 's', false)).toBe(greeting(at(9), 's', false));
  });
});

describe('what to say while it works', () => {
  const step = (status: 'running' | 'done') => ({ id: '1', tool: 'read_file', title: 't', status });
  it('says nothing when a step or the answer already shows what is happening', () => {
    expect(workingLabel({ steps: [step('running')], content: '', reasoning: '' })).toBe('');
    expect(workingLabel({ steps: [], content: 'Hello', reasoning: '' })).toBe('');
  });
  it('fills the gaps', () => {
    expect(workingLabel(undefined)).toBe('Thinking');
    expect(workingLabel({ steps: [], content: '', reasoning: '' })).toBe('Thinking');
    expect(workingLabel({ steps: [step('done')], content: '', reasoning: '' })).toBe('Working out the next step');
    expect(workingLabel({ steps: [step('done')], content: '', reasoning: 'hmm' })).toBe('Thinking');
  });
});

describe('time on a long step', () => {
  it('reads as seconds, then minutes', () => {
    expect([0, 4, 59, 60, 65, 3725, -3, 12.9].map(formatElapsed)).toEqual(['0s', '4s', '59s', '1m 00s', '1m 05s', '62m 05s', '0s', '12s']);
  });
});

describe('a plan as a checklist', () => {
  it('goes to text and back unchanged, and ignores anything else', () => {
    const plan = [{ step: 'Read the code', status: 'completed' as const }, { step: 'Fix the bug', status: 'in_progress' as const }, { step: 'Run the tests', status: 'pending' as const }];
    expect(planToText(plan)).toBe('[x] Read the code\n[>] Fix the bug\n[ ] Run the tests');
    expect(planFromText(planToText(plan))).toEqual(plan);
    expect(planFromText('hello\n[?] nope\n[x] ok\n\n[ ] ')).toEqual([{ step: 'ok', status: 'completed' }]);
  });
});
