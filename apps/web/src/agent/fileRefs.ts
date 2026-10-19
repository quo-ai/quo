/**
 * Spotting a file in the agent's words: `src/app.ts`, `src/app.ts:42`, `./pages/index.html`, or a markdown link to one.
 * Deliberately only the shape; whether the file is really in the project is checked against the project before it
 * becomes a link (agent/codePanel.ts), so "node.js" or "e.g." in a sentence never turns into a dead link.
 */

export interface FileRef {
  path: string;
  line?: number;
}

const SHAPE = /^((?:~?\.{0,2}\/)?(?:[\w@+-][\w@+.-]*\/)*[\w@+-][\w@+.-]*\.[A-Za-z][A-Za-z0-9]{0,7})(?::(\d{1,6})(?::\d{1,6})?|#L(\d{1,6}))?$/;

export function parseFileRef(text: string): FileRef | null {
  const value = text.trim();
  if (value.length < 3 || value.length > 300 || /\s/.test(value) || value.includes('://') || value.includes('..') || /(^|\/)-/.test(value)) return null;
  const match = SHAPE.exec(value);
  if (!match) return null;
  const line = Number(match[2] ?? match[3]);
  return { path: match[1], ...(Number.isFinite(line) && line > 0 ? { line } : {}) };
}

/** A markdown link's address as a file in the project, or null for a web address, an anchor, an e-mail link and the like. */
export function fileRefFromHref(href: string | undefined): FileRef | null {
  if (!href || href.startsWith('#') || href.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(href)) return null;
  let decoded = href;
  try {
    decoded = decodeURI(href);
  } catch {
    return null;
  }
  return parseFileRef(decoded);
}
