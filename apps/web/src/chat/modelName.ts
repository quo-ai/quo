/**
 * A provider's model id as people say it: "claude-sonnet-5-5" is Claude Sonnet 5.5, "gpt-6.1-sol" is GPT-6.1 Sol. Used
 * where Quo shows which exact model answered, so the name and the id aren't both on screen (the id stays in the tooltip).
 * Only the patterns below are read; anything else gives null and the caller shows the name the person chose.
 */

const word = (part: string) => part.charAt(0).toUpperCase() + part.slice(1);
const DATE = /^\d{8}$|^\d{4}-\d{2}-\d{2}$|^latest$|^preview$/;

export function readableModel(id: string | null | undefined): string | null {
  if (!id) return null;
  const parts = id.replace(/^.*\//, '').toLowerCase().split('-').filter(part => part && !DATE.test(part));
  if (parts.length < 2) return null;
  const [maker, ...rest] = parts;
  const version = (pieces: string[]) => pieces.join('.');
  if (maker === 'claude') {
    // claude-sonnet-5-5, claude-opus-4-1, claude-3-5-sonnet (the older order)
    const family = rest.findIndex(part => !/^\d+$/.test(part));
    if (family === -1) return null;
    const numbers = rest.filter(part => /^\d+$/.test(part));
    const name = word(rest[family]);
    if (!numbers.length) return `Claude ${name}`;
    return family === 0 ? `Claude ${name} ${version(numbers)}` : `Claude ${version(numbers)} ${name}`;
  }
  if (maker === 'gpt' && /^\d/.test(rest[0])) return `GPT-${rest[0]}${rest.slice(1).map(part => ` ${word(part)}`).join('')}`;
  if (maker === 'gemini' && /^\d/.test(rest[0])) return `Gemini ${rest.map(part => (/^\d/.test(part) ? part : word(part))).join(' ')}`;
  return null;
}
