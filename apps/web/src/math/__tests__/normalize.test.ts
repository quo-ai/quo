import { describe, expect, it } from 'vitest';
import { hasMath, normalizeMath } from '../normalize';

describe('finding maths in a reply', () => {
  it('notices each way models write it, and not plain prices or text', () => {
    for (const text of ['so \\(x^2\\) grows', '\\[E = mc^2\\]', '$$a+b$$', 'where $x_1$ is', 'take $\\frac{1}{2}$']) expect(hasMath(text), text).toBe(true);
    for (const text of ['It costs $5 and $10.', 'Plain text.', 'a $ sign']) expect(hasMath(text), text).toBe(false);
  });
});

describe('rewriting maths for the renderer', () => {
  it('turns \\( \\) into inline maths and \\[ \\] into a display formula', () => {
    expect(normalizeMath('so \\(x^2\\) grows')).toBe('so $$x^2$$ grows');
    expect(normalizeMath('Energy:\n\\[ E = mc^2 \\]\ndone')).toBe('Energy:\n\n$$\nE = mc^2\n$$\n\ndone');
    expect(normalizeMath('\\[\n\\int_0^1 x\\,dx\n\\]')).toBe('\n$$\n\\int_0^1 x\\,dx\n$$\n');
  });

  it('makes $$ … $$ alone on a line a display formula, and leaves $$ inside a sentence inline', () => {
    expect(normalizeMath('Area:\n$$ \\pi r^2 $$\nso')).toBe('Area:\n$$\n\\pi r^2\n$$\nso');
    expect(normalizeMath('the area $$\\pi r^2$$ grows')).toBe('the area $$\\pi r^2$$ grows');
  });

  it('keeps prices as text, but not maths that starts with a number', () => {
    expect(normalizeMath('It costs $5 and $10 with $x$ taxed.')).toBe('It costs \\$5 and \\$10 with $x$ taxed.');
    expect(normalizeMath('so $2^{10}$ bytes')).toBe('so $2^{10}$ bytes');
    expect(normalizeMath('Pay $1,200 by \\(t_0\\)')).toBe('Pay \\$1,200 by $$t_0$$');
    expect(normalizeMath('already \\$5')).toBe('already \\$5');
  });

  it('never touches code, fenced or inline', () => {
    const fenced = 'Run:\n```sh\necho "$5 \\(x\\)"\n```\nthen \\(y\\)';
    expect(normalizeMath(fenced)).toBe('Run:\n```sh\necho "$5 \\(x\\)"\n```\nthen $$y$$');
    expect(normalizeMath('use `$1` and ``a ` \\(b\\)`` but \\(c\\)')).toBe('use `$1` and ``a ` \\(b\\)`` but $$c$$');
    expect(normalizeMath('~~~\n$5\n~~~')).toBe('~~~\n$5\n~~~');
    expect(normalizeMath('```\nnot closed $5')).toBe('```\nnot closed $5');
  });
});

describe('drawing maths', () => {
  it('draws inline and display formulas with KaTeX, keeps prices as text, and refuses links in a formula', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { createElement } = await import('react');
    const { default: ReactMarkdown } = await import('react-markdown');
    const { default: remarkGfm } = await import('remark-gfm');
    const { MATH } = await import('../load');
    const draw = (text: string) => renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [remarkGfm, MATH.remark], rehypePlugins: [MATH.rehype] }, normalizeMath(text)));
    const html = draw('It costs $5 and $10. So \\(x^2\\) and\n\\[\\frac{a}{b}\\]');
    expect(html).toContain('$5 and $10');
    expect(html).toMatch(/class="katex"/);
    expect(html).toMatch(/class="katex-display"/);
    expect(html).toContain('<annotation encoding="application/x-tex">x^2</annotation>');
    const link = draw('\\(\\href{javascript:alert(1)}{x}\\)');
    expect(link).not.toMatch(/<a /);
    expect(link).not.toContain('href="javascript');
  });
});
