import type { ThemeRegistration } from 'shiki/core';

/**
 * Quo's code colours as a Shiki theme. Every colour is a role, not a value: the theme names a role and
 * styles/syntax.css gives it a colour per scheme, style and accent (all AA on --code-bg, themes.css.test.ts).
 * Seven roles, so code reads like GitHub or VS Code without being loud.
 */

export const ROLES = ['keyword', 'string', 'constant', 'function', 'type', 'comment', 'punct', 'inserted', 'deleted', 'changed'] as const;
export type Role = (typeof ROLES)[number];

const role = (name: Role) => `var(--syn-${name})`;

export const QUO_THEME: ThemeRegistration = {
  name: 'quo',
  type: 'dark',
  colors: { 'editor.foreground': 'var(--syn-fg)', 'editor.background': 'var(--code-bg)' },
  tokenColors: [
    { scope: ['comment', 'punctuation.definition.comment', 'string.quoted.docstring'], settings: { foreground: role('comment'), fontStyle: 'italic' } },
    { scope: ['keyword', 'storage', 'storage.type', 'storage.modifier', 'keyword.control', 'entity.name.tag', 'keyword.other.special-method', 'markup.heading', 'meta.preprocessor', 'keyword.directive'], settings: { foreground: role('keyword') } },
    { scope: ['keyword.operator', 'punctuation', 'meta.brace', 'keyword.operator.assignment'], settings: { foreground: role('punct') } },
    { scope: ['keyword.operator.new', 'keyword.operator.expression', 'keyword.operator.logical.python', 'keyword.operator.word'], settings: { foreground: role('keyword') } },
    { scope: ['string', 'string.template', 'markup.inline.raw', 'markup.fenced_code', 'punctuation.definition.string'], settings: { foreground: role('string') } },
    { scope: ['string.regexp', 'constant.character.escape', 'constant.other.placeholder'], settings: { foreground: role('constant') } },
    { scope: ['constant', 'constant.numeric', 'constant.language', 'support.constant', 'variable.other.constant', 'variable.other.enummember', 'variable.language'], settings: { foreground: role('constant') } },
    { scope: ['entity.name.function', 'support.function', 'variable.function', 'meta.function-call entity.name.function', 'support.type.property-name', 'meta.object-literal.key', 'entity.other.attribute-name.id', 'markup.underline.link'], settings: { foreground: role('function') } },
    { scope: ['entity.name.type', 'entity.name.class', 'entity.name.namespace', 'support.type', 'support.class', 'entity.other.inherited-class', 'entity.other.attribute-name', 'storage.type.primitive', 'entity.name.type.module'], settings: { foreground: role('type') } },
    { scope: ['markup.bold', 'markup.heading'], settings: { fontStyle: 'bold' } },
    { scope: ['markup.italic'], settings: { fontStyle: 'italic' } },
    { scope: ['markup.inserted', 'punctuation.definition.inserted'], settings: { foreground: role('inserted') } },
    { scope: ['markup.deleted', 'punctuation.definition.deleted'], settings: { foreground: role('deleted') } },
    { scope: ['markup.changed', 'meta.diff.range', 'meta.diff.header'], settings: { foreground: role('changed') } },
    { scope: ['invalid'], settings: { foreground: role('deleted') } },
  ],
};

/** The role a colour from this theme stands for, or null for plain text. */
export function roleOf(color: string | undefined): Role | null {
  const name = /^var\(--syn-([a-z]+)\)$/.exec(color ?? '')?.[1];
  return name && (ROLES as readonly string[]).includes(name) ? (name as Role) : null;
}
