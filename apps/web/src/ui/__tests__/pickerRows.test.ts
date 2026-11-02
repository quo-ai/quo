import { describe, expect, it } from 'vitest';
import { SECTION_LIMIT, visibleRows } from '../pickerRows';

const items = ['a', 'b', 'c', 'd', 'e', 'f'];

describe('a section of the model menu', () => {
  it('shows the first few, and how many more there are', () => {
    expect(visibleRows(items, () => false, false)).toEqual({ shown: ['a', 'b', 'c'], hidden: 3 });
    expect(SECTION_LIMIT).toBe(3);
  });

  it('always shows the model in use, even when it is further down', () => {
    expect(visibleRows(items, item => item === 'e', false)).toEqual({ shown: ['a', 'b', 'e'], hidden: 3 });
    expect(visibleRows(items, item => item === 'b', false)).toEqual({ shown: ['a', 'b', 'c'], hidden: 3 });
  });

  it('shows everything when opened, or when there are only a few', () => {
    expect(visibleRows(items, () => false, true)).toEqual({ shown: items, hidden: 0 });
    expect(visibleRows(['a', 'b'], () => false, false)).toEqual({ shown: ['a', 'b'], hidden: 0 });
  });
});
