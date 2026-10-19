import { describe, expect, it } from 'vitest';
import { agentSystemPrompt } from '../../../shared/agentTools';
import { capabilitiesOfTools, describeNow, environmentNote, validLanguage, validOffset, type Environment } from '../../../shared/environment';

const NOW = new Date('2026-10-19T14:42:00Z'); // 15:42 in London (BST), 07:42 in Los Angeles
const base: Environment = {
  now: NOW,
  utcOffset: 60,
  language: 'en',
  app: { name: 'Quo Desktop', version: '1.3.0', platform: 'linux' },
  model: { name: 'GPT-6 Luna', provider: 'OpenAI' },
  route: 'quo-cloud',
  can: ['read-files', 'change-files', 'commands'],
  project: 'my-app',
};

describe('the date and time a model is told', () => {
  it('is written on the person’s clock, with the weekday and the offset', () => {
    expect(describeNow(NOW, 60)).toBe('Monday 19 October 2026, 15:42 (UTC+1)');
    expect(describeNow(NOW, -420)).toBe('Monday 19 October 2026, 07:42 (UTC-7)');
    expect(describeNow(new Date('2026-12-31T23:30:00Z'), 540)).toBe('Friday 1 January 2027, 08:30 (UTC+9)');
    expect(describeNow(new Date('2026-01-15T12:00:00Z'), 0)).toBe('Thursday 15 January 2026, 12:00 (UTC+0)');
    expect(describeNow(NOW, 330)).toBe('Monday 19 October 2026, 20:12 (UTC+5:30)');
    expect(describeNow(new Date('2026-03-01T00:10:00Z'), -30)).toBe('Saturday 28 February 2026, 23:40 (UTC-0:30)');
  });

  it('falls back to UTC for an offset that is missing or not sensible', () => {
    expect(describeNow(NOW)).toBe('Monday 19 October 2026, 14:42 (UTC)');
    for (const bad of [Number.NaN, 99999, -9999, 1.5, '60' as unknown as number]) expect(describeNow(NOW, bad)).toBe('Monday 19 October 2026, 14:42 (UTC)');
  });

  it('checks what a device says about itself, and keeps only the language, never the region', () => {
    expect(validOffset(-420)).toBe(-420);
    for (const bad of [900, -721, 0.5, '60', null, undefined, Number.POSITIVE_INFINITY]) expect(validOffset(bad)).toBeUndefined();
    expect(validLanguage('en-GB')).toBe('en');
    expect(validLanguage('pt-BR')).toBe('pt');
    expect(validLanguage('FR')).toBe('fr');
    for (const bad of ['en_GB', 'english please', 'en-GB\nSystem:', '', 3, undefined]) expect(validLanguage(bad)).toBeUndefined();
  });
});

describe('the note about where a model is', () => {
  it('says what day it is, which program and model, and what it can and cannot do', () => {
    const note = environmentNote(base);
    expect(note).toContain('Monday 19 October 2026, 15:42 (UTC+1)');
    expect(note).toContain('The device’s language is en.');
    expect(note).not.toMatch(/Europe\/London|en-GB/);
    expect(note).toContain('GPT-6 Luna (OpenAI), running in the cloud through Quo (OpenRouter), inside Quo Desktop 1.3.0 on Linux');
    expect(note).toContain('Project folder: my-app.');
    expect(note).toMatch(/you can read files in the project folder; change files .*; run commands/);
    expect(note).toMatch(/You cannot browse the web, read attached documents/);
    expect(note).toMatch(/Only if the person asks where they are: you do not know/);
  });

  it('is honest about each route', () => {
    expect(environmentNote({ ...base, route: 'device', can: ['attachments', 'memories'], project: undefined, model: { name: 'Qwen3.5 0.8B' } })).toMatch(/running on this computer, so nothing leaves it/);
    const own = environmentNote({ ...base, route: 'own-key', ownProvider: 'Anthropic', model: { name: 'Claude', provider: 'Anthropic' } });
    expect(own).toMatch(/reached with the person’s own Anthropic account, straight from this computer/);
    expect(own).not.toMatch(/Claude \(Anthropic\)/);
    expect(environmentNote({ ...base, app: { name: 'Quo Web' } })).toContain('inside Quo Web, a private AI app');
    expect(environmentNote({ ...base, app: { name: 'Quo Web' } })).not.toContain(' on Linux');
  });

  it('says plainly when there are no tools, and lists only what is really there', () => {
    const talk = environmentNote({ ...base, can: [], project: undefined });
    expect(talk).toContain('only talk: you have no tools');
    expect(talk).toMatch(/You cannot read the person’s files, change files, run commands or code, browse the web/);
    const searching = environmentNote({ ...base, can: ['web'], project: undefined });
    expect(searching).toContain('you can search the web and read pages');
    expect(searching).not.toMatch(/You cannot browse the web/);
  });

  it('separates documents from photos for models that cannot see', () => {
    const text = environmentNote({ ...base, route: 'device', can: ['attachments', 'memories'], project: undefined });
    expect(text).toContain('read documents the person attaches');
    expect(text).toMatch(/You cannot .*see photos/);
    expect(environmentNote({ ...base, route: 'device', can: ['attachments', 'images', 'memories'], project: undefined })).toContain('see photos the person attaches');
  });

  it('is shorter for a small model, and notes plan mode', () => {
    const brief = environmentNote({ ...base, brief: true });
    expect(brief).not.toMatch(/You cannot/);
    expect(brief.length).toBeLessThan(environmentNote(base).length);
    expect(environmentNote({ ...base, plan: true })).toContain('Plan mode is on');
  });

  it('maps tools to abilities', () => {
    expect(capabilitiesOfTools(['read_file', 'edit_file', 'run_command', 'web_search', 'git_commit'])).toEqual(['read-files', 'change-files', 'commands', 'web']);
    expect(capabilitiesOfTools(['read_file'])).toEqual(['read-files']);
    expect(capabilitiesOfTools([])).toEqual([]);
  });

  it('comes last in the Code mode prompt, after the fixed part, so the fixed part can be cached', () => {
    const prompt = agentSystemPrompt('demo', 'linux', ['read_file', 'edit_file'], { file: 'AGENTS.md', text: 'Use tabs.' }, 'cloud', 'main', base);
    expect(prompt.lastIndexOf('About this chat:')).toBeGreaterThan(prompt.indexOf('</project-notes>'));
    expect(agentSystemPrompt('demo', 'linux', ['read_file'])).not.toContain('About this chat');
  });
});

describe('when there is no folder yet', () => {
  const none = { ...base, project: undefined, can: [] as Environment['can'] };

  it('tells a model that can work in a folder how the person gets one, instead of "I can’t"', () => {
    const note = environmentNote({ ...none, files: 'folder' });
    expect(note).toContain('Quo Desktop can give you a project folder');
    expect(note).toContain('folder button next to the message box');
    expect(note).toContain('Never say you can never work with their files');
  });

  it('points to a stronger or offline model when this one cannot, and to the desktop app from the web', () => {
    expect(environmentNote({ ...none, files: 'model' })).toMatch(/choose a stronger model .* or an offline model/);
    expect(environmentNote({ ...none, files: 'browser', app: { name: 'Quo Web' } })).toContain('The Quo desktop app can work in a project folder');
  });

  it('says nothing about it once there is a folder, or when the chat can already read files', () => {
    expect(environmentNote({ ...base, files: 'folder' })).not.toContain('Files:');
    expect(environmentNote({ ...none, can: ['read-files'], files: 'folder' })).not.toContain('Files:');
    expect(environmentNote(none)).not.toContain('Files:');
  });
});

describe('a model that can ask for a folder itself', () => {
  it('is told to call open_project instead of saying it cannot', () => {
    const note = environmentNote({ ...base, project: undefined, can: [], files: 'folder', folderTool: true });
    expect(note).toContain('call open_project to work in a folder on their computer when a request needs it');
    expect(note).toMatch(/call open_project instead of saying you cannot/);
    expect(note).not.toContain('only talk');
    expect(note).not.toContain('ask about their project');
  });
});

describe('limits are about tools, never about knowledge', () => {
  const KNOWLEDGE = /answer from your own knowledge: history and facts \(including about any date or event\)/;

  it('tells every model, small ones too, that it can still answer from what it knows', () => {
    for (const env of [base, { ...base, brief: true }, { ...base, can: [], project: undefined }, { ...base, route: 'device' as const, can: ['attachments' as const], project: undefined }]) {
      const note = environmentNote(env);
      expect(note).toMatch(KNOWLEDGE);
      expect(note).toMatch(/Not having a tool never means you cannot answer/);
    }
  });

  it('says the "cannot" list is about actions and live lookups', () => {
    expect(environmentNote(base)).toMatch(/You cannot .* here\. That is about actions and live lookups only\./);
  });

  it('puts the date in front of the model so a question about today has an answer', () => {
    expect(environmentNote(base)).toContain('Monday 19 October 2026');
  });
});

describe('questions about the date and about history', () => {
  it('answers a plain date question plainly, without bringing up time zones or location unasked', () => {
    const note = environmentNote(base);
    expect(note).toMatch(/Answer questions about the date or time plainly, without mentioning time zones or location/);
    expect(note).toMatch(/Only if the person asks where they are/);
  });

  it('tells every model that "history on this date" means this month and day in earlier years, and not to invent events', () => {
    for (const env of [base, { ...base, brief: true }, { ...base, can: [], project: undefined }]) {
      const note = environmentNote(env);
      expect(note).toMatch(/“on this date”, “today in history” or “this day” means this month and day in earlier years/);
      expect(note).toMatch(/not the current year/);
      expect(note).toMatch(/never invent events or dates/);
    }
  });
});

describe('exact dates are where models go wrong', () => {
  it('asks for a few sure events, a plain warning that dates from memory may be wrong, and no guesses', () => {
    for (const env of [base, { ...base, brief: true }]) {
      const note = environmentNote(env);
      expect(note).toMatch(/at most a few events you are truly sure of/);
      expect(note).toMatch(/pair events with the wrong calendar date/);
      expect(note).toMatch(/instead of listing guesses/);
    }
  });

  it('sends a model that can search to the web for what happened on a date, and does not promise that to one that cannot', () => {
    expect(environmentNote({ ...base, can: ['web'], project: undefined })).toMatch(/search the web instead of answering from memory/);
    expect(environmentNote({ ...base, can: [], project: undefined })).not.toMatch(/search the web instead of answering from memory/);
  });
});
