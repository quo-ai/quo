import { describe, expect, it } from 'vitest';
import { greeting, pickStarters, POOLS } from '../starters';
import { asImageAsk } from '../../images/tags';
import { workingLabel } from '../working';
import { formatElapsed } from '../../ui/elapsed';
import { planFromText, planToText } from '../../agent/plan';

describe('what an empty chat suggests', () => {
  it('gives four different starters that fit where the person is', () => {
    const chat = pickStarters('chat', 'a');
    expect(chat).toHaveLength(4);
    expect(new Set(chat.map(s => s.title)).size).toBe(4);
    expect(chat.filter(s => POOLS.PICTURES.includes(s))).toHaveLength(1);
    expect(chat.filter(s => POOLS.EVERYDAY.includes(s))).toHaveLength(3);
    expect(pickStarters('project', 'a').every(s => POOLS.PROJECT.includes(s))).toBe(true);
    const mixed = pickStarters('mixed', 'a');
    expect(mixed.filter(s => POOLS.PICTURES.includes(s))).toHaveLength(1);
    expect(mixed.filter(s => POOLS.BUILD.includes(s))).toHaveLength(2);
    expect(mixed.filter(s => POOLS.EVERYDAY.includes(s))).toHaveLength(1);
  });

  it('always offers one picture outside a project, as an /image request any model can make, in different places', () => {
    const places = new Set<number>();
    for (let i = 0; i < 40; i++) {
      for (const mode of ['chat', 'mixed'] as const) {
        const set = pickStarters(mode, `seed-${i}`);
        const pictures = set.filter(s => POOLS.PICTURES.includes(s));
        expect(pictures).toHaveLength(1);
        expect(asImageAsk(pictures[0].prompt)).toMatch(/^Make an image: \S/);
        places.add(set.indexOf(pictures[0]));
      }
      expect(pickStarters('project', `seed-${i}`).some(s => POOLS.PICTURES.includes(s))).toBe(false);
    }
    expect(places.size).toBeGreaterThan(2);
  });

  it('suggests no picture where pictures can’t be made (a copy without Quo’s server), and still gives four', () => {
    for (let i = 0; i < 20; i++) {
      for (const mode of ['chat', 'mixed'] as const) {
        const set = pickStarters(mode, `seed-${i}`, 4, false);
        expect(set).toHaveLength(4);
        expect(set.some(s => POOLS.PICTURES.includes(s))).toBe(false);
      }
    }
  });

  it('stays the same for the same chat and day, and varies between them', () => {
    expect(pickStarters('chat', 'chat-1:2026-10-19')).toEqual(pickStarters('chat', 'chat-1:2026-10-19'));
    const sets = new Set(Array.from({ length: 40 }, (_, i) => pickStarters('chat', `chat-${i}`).map(s => s.title).join('|')));
    expect(sets.size).toBeGreaterThan(20);
  });

  it('has real prompts, and never health or medical topics', () => {
    for (const s of [...POOLS.EVERYDAY, ...POOLS.PROJECT, ...POOLS.BUILD, ...POOLS.PICTURES]) {
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
