import { convertHtmlBreaks, preprocessMath, splitCodeSegments } from '../mathUnicode';

describe('preprocessMath', () => {
  it('converts inline and display math in prose', () => {
    expect(preprocessMath('Area is $\\pi r^2$.')).toBe('Area is `π r²`.');
    expect(preprocessMath('$$x_1 + x_2$$')).toContain('```\nx₁ + x₂\n```');
  });

  it('leaves fenced code untouched', () => {
    const bash = '```bash\necho $HOME and $PATH\nprice=$$\nx_1=$((a_b))\n```';
    expect(preprocessMath(bash)).toBe(bash);
  });

  it('leaves an unclosed (streaming) fence untouched', () => {
    const open = 'Run:\n```sh\nexport A=$HOME/$USER';
    expect(preprocessMath(open)).toBe(open);
  });

  it('leaves inline code spans untouched', () => {
    const text = 'Use `$HOME` and ``a`$x$`b`` here';
    expect(preprocessMath(text)).toBe(text);
  });

  it('still converts math next to code', () => {
    expect(preprocessMath('`$HOME` vs $\\alpha$')).toBe('`$HOME` vs `α`');
  });

  it('does not treat currency as math', () => {
    expect(preprocessMath('It costs $5 and $10.')).toBe('It costs $5 and $10.');
    expect(preprocessMath('Between $5 and $ 10')).toBe('Between $5 and $ 10');
  });

  it('does not match shell-style variables in prose', () => {
    expect(preprocessMath('Set $HOME and $PATH first')).toBe('Set $HOME and $PATH first');
  });

  it('returns text without $ or \\ as-is', () => {
    expect(preprocessMath('plain text')).toBe('plain text');
  });
});

describe('splitCodeSegments', () => {
  it('splits fences and inline spans from prose', () => {
    const segments = splitCodeSegments('a `b` c\n```\nd\n```\ne');
    expect(segments).toEqual([
      { code: false, text: 'a ' },
      { code: true, text: '`b`' },
      { code: false, text: ' c\n' },
      { code: true, text: '```\nd\n```\n' },
      { code: false, text: 'e' },
    ]);
  });

  it('treats an unmatched backtick as text', () => {
    expect(splitCodeSegments('a ` b')).toEqual([{ code: false, text: 'a ` b' }]);
  });
});

describe('HTML line breaks from small models', () => {
  it('turns <br> in table cells into a separator, keeping the row on one line', () => {
    expect(convertHtmlBreaks('| May | Plant out<br>Install butts |')).toBe('| May | Plant out · Install butts |');
  });

  it('does not double up when the model already starts the next item with a bullet', () => {
    expect(convertHtmlBreaks('| May | • Plant out<br>• Install butts |')).toBe('| May | • Plant out • Install butts |');
  });

  it('turns <br> in prose into a newline', () => {
    expect(convertHtmlBreaks('Line one<br/>Line two')).toBe('Line one\nLine two');
  });

  it('leaves code untouched', () => {
    expect(preprocessMath('`<br>` and text<br>more')).toBe('`<br>` and text\nmore');
  });
});
