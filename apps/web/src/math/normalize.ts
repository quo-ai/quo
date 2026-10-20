/**
 * Models write maths in three ways: \( inline \), \[ display \] and $…$ / $$…$$. remark-math reads only the dollar forms,
 * so the others are rewritten into them, outside code. A $ before a number is money ("$5 and $10"), not maths, unless
 * what follows up to the next $ is clearly maths (has \ ^ _ { or }): it is escaped so it stays text.
 */

/** Whether a reply may hold maths, so KaTeX is loaded only then. Cheap and generous: a false hit only loads it. */
export const hasMath = (text: string): boolean => /\\\(|\\\[|\$\$|\$[^$\n]*[\\^_{}][^$\n]*\$/.test(text);

interface Part { code: boolean; text: string }

/** Fenced code blocks (``` or ~~~, closed by the same fence or the end), as whole lines. */
function splitFences(text: string): Part[] {
  const parts: Part[] = [];
  let fence: string | null = null;
  let current = '';
  const push = (code: boolean) => {
    if (current) parts.push({ code, text: current });
    current = '';
  };
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    const piece = index < lines.length - 1 ? `${line}\n` : line;
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence === null && marker) {
      push(false);
      fence = marker;
      current = piece;
    } else if (fence !== null && marker && marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) {
      current += piece;
      push(true);
      fence = null;
    } else current += piece;
  });
  push(fence !== null);
  return parts;
}

/** Inline code spans (`x`, ``x``) inside prose. */
function splitInline(text: string): Part[] {
  const parts: Part[] = [];
  let at = 0;
  for (const match of text.matchAll(/(`+)(?!`)[\s\S]*?[^`]\1(?!`)/g)) {
    if (match.index > at) parts.push({ code: false, text: text.slice(at, match.index) });
    parts.push({ code: true, text: match[0] });
    at = match.index + match[0].length;
  }
  if (at < text.length) parts.push({ code: false, text: text.slice(at) });
  return parts;
}

function escapeMoney(text: string): string {
  return text.replace(/(?<![\\$])\$(?=\d)/g, (sign, offset: number) => {
    const rest = text.slice(offset + 1);
    const end = rest.search(/[$\n]/);
    const isMaths = end >= 0 && rest[end] === '$' && rest[end + 1] !== '$' && /[\\^_{}]/.test(rest.slice(0, end));
    return isMaths ? sign : '\\$';
  });
}

function rewrite(prose: string): string {
  const display = (body: string) => `\n$$\n${body.trim()}\n$$\n`;
  return escapeMoney(prose
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, body: string) => display(body))
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, body: string) => `$$${body.trim()}$$`)
    // $$ … $$ alone on a line is a display formula, not inline maths.
    .replace(/^[ \t]*\$\$([^\n$]+?)\$\$[ \t]*$/gm, (_, body: string) => display(body).slice(1, -1)));
}

export function normalizeMath(text: string): string {
  return splitFences(text)
    .map(part => (part.code ? part.text : splitInline(part.text).map(piece => (piece.code ? piece.text : rewrite(piece.text))).join('')))
    .join('');
}
