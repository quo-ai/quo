import { describe, expect, it } from 'vitest';
import { detailOf, errorFor } from '../errors';
import { ANTHROPIC, OPENAI } from './helpers';

describe('what a provider’s refusal turns into', () => {
  const json = (message: string) => JSON.stringify({ error: { message } });

  it('says what to do for each kind of problem', () => {
    expect(errorFor(OPENAI, 401, json('Incorrect API key'))).toMatchObject({ code: 'provider_auth', provider: 'openai', message: expect.stringContaining('didn’t accept your key') });
    expect(errorFor(ANTHROPIC, 403, '')).toMatchObject({ code: 'provider_auth' });
    expect(errorFor(OPENAI, 402, '')).toMatchObject({ code: 'provider_credit' });
    expect(errorFor(OPENAI, 429, json('You exceeded your current quota, check your billing details'))).toMatchObject({ code: 'provider_credit' });
    expect(errorFor(OPENAI, 429, json('Rate limit reached'))).toMatchObject({ code: 'provider_limit' });
    expect(errorFor(OPENAI, 404, json('The model `x` does not exist'))).toMatchObject({ code: 'provider_model', message: expect.stringContaining('does not exist') });
    expect(errorFor(OPENAI, 503, 'upstream')).toMatchObject({ code: 'provider_server' });
    expect(errorFor(OPENAI, 400, json('context length exceeded'))).toMatchObject({ code: 'provider_failed', message: expect.stringContaining('context length exceeded') });
  });

  it('reads the message from either error shape, or plain text, and keeps it short', () => {
    expect(detailOf(json('A'))).toBe('A');
    expect(detailOf(JSON.stringify({ error: 'plain' }))).toBe('plain');
    expect(detailOf(JSON.stringify({ message: 'top level' }))).toBe('top level');
    expect(detailOf('  not json\n\nat all ')).toBe('not json at all');
    expect(detailOf(json('x'.repeat(500))).length).toBeLessThan(230);
  });

  it('never repeats anything shaped like a key', () => {
    const key = `${'sk'}-${'proj'}-${'a1b2c3d4e5f6g7h8i9'}`;
    expect(detailOf(json(`Incorrect API key provided: ${key}.`))).not.toContain('a1b2c3d4e5f6');
    expect(detailOf(json(`bad ${'AI'}${'za'}${'x'.repeat(30)}`))).toContain('[key removed]');
  });
});
