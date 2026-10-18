import { incompleteUtf8TailLength } from '../fileExtractor';

const bytes = (s: string) => Array.from(new TextEncoder().encode(s));

describe('incompleteUtf8TailLength', () => {
  it('is 0 when the buffer ends on a character boundary', () => {
    expect(incompleteUtf8TailLength(bytes('abcd'))).toBe(0);
    expect(incompleteUtf8TailLength(bytes('aé'))).toBe(0);
    expect(incompleteUtf8TailLength(bytes('€'))).toBe(0);
    expect(incompleteUtf8TailLength(bytes('😀'))).toBe(0);
    expect(incompleteUtf8TailLength([])).toBe(0);
  });

  it('counts the bytes of a truncated trailing sequence', () => {
    const euro = bytes('ab€'); // 61 62 E2 82 AC
    expect(incompleteUtf8TailLength(euro.slice(0, 4))).toBe(2);
    expect(incompleteUtf8TailLength(euro.slice(0, 3))).toBe(1);
    const emoji = bytes('a😀'); // 61 F0 9F 98 80
    expect(incompleteUtf8TailLength(emoji.slice(0, 4).slice(-4))).toBe(3);
    expect(incompleteUtf8TailLength(emoji.slice(0, 3))).toBe(2);
    expect(incompleteUtf8TailLength(emoji.slice(0, 2))).toBe(1);
  });
});
