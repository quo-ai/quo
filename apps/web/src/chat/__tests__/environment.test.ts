import { describe, expect, it } from 'vitest';
import { agentSystemPrompt } from '../../../shared/agentTools';
import { describeNow, environmentNote, validOffset, type Environment } from '../../../shared/environment';

const NOW = new Date('2026-10-19T14:42:00Z'); // 15:42 in London (BST), 07:42 in Los Angeles
const base: Environment = { now: NOW, utcOffset: 60, model: { name: 'GPT-6 Luna', provider: 'OpenAI' }, route: 'quo-cloud' };

describe('the date and time a model is told', () => {
  it('is on the person’s clock, with the weekday, and does not show the offset', () => {
    expect(describeNow(NOW, 60)).toBe('Monday 19 October 2026, 15:42');
    expect(describeNow(NOW, -420)).toBe('Monday 19 October 2026, 07:42');
    expect(describeNow(new Date('2026-12-31T23:30:00Z'), 540)).toBe('Friday 1 January 2027, 08:30');
    expect(describeNow(NOW, 330)).toBe('Monday 19 October 2026, 20:12');
    expect(describeNow(new Date('2026-03-01T00:10:00Z'), -30)).toBe('Saturday 28 February 2026, 23:40');
  });

  it('is UTC, and says so, when the offset is missing or not sensible', () => {
    expect(describeNow(NOW)).toBe('Monday 19 October 2026, 14:42 UTC');
    for (const bad of [Number.NaN, 99999, -9999, 1.5, '60' as unknown as number]) expect(describeNow(NOW, bad)).toBe('Monday 19 October 2026, 14:42 UTC');
  });

  it('checks what a device says about itself', () => {
    expect(validOffset(-420)).toBe(-420);
    for (const bad of [900, -721, 0.5, '60', null, undefined, Number.POSITIVE_INFINITY]) expect(validOffset(bad)).toBeUndefined();
  });
});

describe('the note', () => {
  it('is three short lines: today, which model and where it runs, and not to guess', () => {
    const note = environmentNote(base);
    expect(note.trim().split('\n')).toEqual([
      'Today is Monday 19 October 2026, 15:42. You are GPT-6 Luna (OpenAI), running in the cloud through Quo.',
      'If you are not sure something you recall is true, say so instead of guessing.',
    ]);
    expect(note.length).toBeLessThan(260);
  });

  it('says where each route runs', () => {
    expect(environmentNote({ ...base, route: 'device', model: { name: 'Qwen3.5 9B' } })).toContain('You are Qwen3.5 9B, running on this computer.');
    const own = environmentNote({ ...base, route: 'own-key', ownProvider: 'Anthropic', model: { name: 'Claude', provider: 'Anthropic' } });
    expect(own).toContain('You are Claude, reached with the person’s own Anthropic account.');
  });

  it('says nothing about time zones, languages, places, programs, what a model cannot do, or any kind of question', () => {
    for (const route of ['device', 'quo-cloud', 'own-key'] as const) {
      const note = environmentNote({ ...base, route });
      expect(note).not.toMatch(/time ?zone|UTC\+|language|location|where in the world|Quo Desktop|Quo Web|cannot|can’t|you can|history|this date|knowledge/i);
    }
  });

  it('comes last in the Code mode prompt, after the fixed part, so the fixed part can still be cached', () => {
    const prompt = agentSystemPrompt('demo', 'linux', ['read_file', 'edit_file'], { file: 'AGENTS.md', text: 'Use tabs.' }, 'cloud', 'main', base);
    expect(prompt.lastIndexOf('Today is')).toBeGreaterThan(prompt.indexOf('</project-notes>'));
    expect(prompt.endsWith('say so instead of guessing.')).toBe(true);
    expect(agentSystemPrompt('demo', 'linux', ['read_file'])).not.toContain('Today is');
  });
});
