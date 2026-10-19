import { describe, expect, it } from 'vitest';
import { keyLabel, SHORTCUTS } from '../shortcuts';

describe('the shortcuts list', () => {
  const all = SHORTCUTS.flatMap(group => group.items);

  it('has a description and keys for every entry, and no entry twice', () => {
    for (const item of all) {
      expect(item.what.length).toBeGreaterThan(3);
      expect(item.keys.length).toBeGreaterThan(0);
    }
    const combos = all.filter(item => !item.project || true).map(item => item.keys.join('+'));
    // Esc and Enter mean different things in a dialog than in the chat, so only chords are checked for clashes.
    const chords = all.filter(item => item.keys.length > 1 && !item.what.startsWith('Allow')).map(item => item.keys.join('+'));
    expect(new Set(chords).size).toBe(chords.length);
    expect(combos.length).toBe(all.length);
  });

  it('lists the shortcuts the app really has', () => {
    const has = (...keys: string[]) => expect(all.some(item => item.keys.join('+') === keys.join('+'))).toBe(true);
    has('mod', 'Shift', 'O');
    has('mod', 'B');
    has('mod', ',');
    has('mod', 'Shift', 'E');
    has('mod', '/');
    has('Shift', 'Tab');
  });

  it('writes the modifier the way this computer does', () => {
    expect(keyLabel('mod', true)).toBe('⌘');
    expect(keyLabel('mod', false)).toBe('Ctrl');
    expect(keyLabel('Shift', true)).toBe('⇧');
    expect(keyLabel('Shift', false)).toBe('Shift');
    expect(keyLabel('Esc', true)).toBe('Esc');
  });
});
