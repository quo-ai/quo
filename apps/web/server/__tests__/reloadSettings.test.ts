// @vitest-environment node
import { expect, it } from 'vitest';
import { refreshSettings } from '../reload.js';

it('a reload gives new workers the settings file as it is now: changed, added and removed settings', () => {
  const env: NodeJS.ProcessEnv = { PATH: '/bin', A: 'old', B: 'gone' };
  const keys = refreshSettings(env, ['A', 'B'], { A: 'new', C: 'added' });
  expect(env).toEqual({ PATH: '/bin', A: 'new', C: 'added' });
  expect(keys).toEqual(['A', 'C']);
});

it('keeps the settings it has when the file can’t be read for a moment', () => {
  const env: NodeJS.ProcessEnv = { A: 'kept' };
  expect(refreshSettings(env, ['A'], null)).toEqual(['A']);
  expect(env).toEqual({ A: 'kept' });
});
