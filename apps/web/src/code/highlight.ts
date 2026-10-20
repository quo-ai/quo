import type { HighlighterCore } from 'shiki/core';
import { LANGUAGES, type Language } from './languages';
import { QUO_THEME, roleOf, type Role } from './theme';

/**
 * Colours code with Shiki (the grammars VS Code uses), on the page, with no network: the engine, the theme and each
 * grammar load the first time they're needed. Returns lines of tokens, each with a role (styles/syntax.css), or null
 * when the code should stay plain (no known language, too long, or a grammar that couldn't load).
 */

export interface Token { text: string; role: Role | null; italic: boolean; bold: boolean }
export type Lines = Token[][];

/** Longer code is shown plain: colouring it would hold up the page. */
export const CHAT_LIMIT = 40_000;
export const FILE_LIMIT = 150_000;

let core: Promise<HighlighterCore> | null = null;
const loaded = new Map<Language, Promise<void>>();

function highlighter(): Promise<HighlighterCore> {
  core ??= Promise.all([import('shiki/core'), import('shiki/engine/javascript')]).then(([{ createHighlighterCore }, { createJavaScriptRegexEngine }]) =>
    createHighlighterCore({ themes: [QUO_THEME], langs: [], engine: createJavaScriptRegexEngine({ forgiving: true }) }));
  core.catch(() => {
    core = null; // offline before it was ever cached: try again next time
  });
  return core;
}

function load(shiki: HighlighterCore, language: Language): Promise<void> {
  let pending = loaded.get(language);
  if (!pending) {
    pending = LANGUAGES[language]().then(grammar => shiki.loadLanguage(grammar.default));
    pending.catch(() => loaded.delete(language));
    loaded.set(language, pending);
  }
  return pending;
}

export async function highlight(code: string, language: Language | null, limit = CHAT_LIMIT): Promise<Lines | null> {
  if (!language || !code || code.length > limit) return null;
  try {
    const shiki = await highlighter();
    await load(shiki, language);
    const { tokens } = shiki.codeToTokens(code, { lang: language, theme: 'quo' });
    return tokens.map(line => line.map(token => {
      const style = token.fontStyle ?? 0;
      return { text: token.content, role: roleOf(token.color), italic: style > 0 && (style & 1) !== 0, bold: style > 0 && (style & 2) !== 0 };
    }));
  } catch {
    return null;
  }
}
