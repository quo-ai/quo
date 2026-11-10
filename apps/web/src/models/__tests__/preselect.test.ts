import { describe, expect, it } from 'vitest';
import { preselectedModelId } from '../preselect';

const models = [{ id: 'qwen35-0.8b' }, { id: 'gemma4-e2b' }];

describe('a link that opens Quo on one model', () => {
  it('preselects a model this browser offers', () => {
    expect(preselectedModelId('?model=gemma4-e2b', models)).toBe('gemma4-e2b');
    expect(preselectedModelId('?x=1&model=Gemma4-E2B', models)).toBe('gemma4-e2b');
  });
  it('ignores anything else: no model, one that isn’t offered here, or something that isn’t an id', () => {
    for (const search of ['', '?model=', '?model=qwen35-9b', '?model=../../etc', '?model=<script>', '?models=gemma4-e2b']) expect(preselectedModelId(search, models), search).toBeNull();
  });
});
