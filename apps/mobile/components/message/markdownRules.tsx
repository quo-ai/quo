import React, { useMemo } from 'react';
import { Platform } from 'react-native';
import Markdown, { RenderRules } from 'react-native-markdown-display';
import MarkdownIt from 'markdown-it';
import { CodeBlock } from '@/components/CodeBlock';
import { borderRadius } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/useTheme';
import { preprocessMath } from '@/components/message/mathUnicode';

/** Themed react-native-markdown-display styles for chat messages. */
export const useMarkdownStyles = makeStyles(({ colors }) => ({
  body: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 26,
  },
  heading1: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '700',
    marginTop: 20,
    marginBottom: 12,
    lineHeight: 32,
  },
  heading2: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '600',
    marginTop: 18,
    marginBottom: 10,
    lineHeight: 28,
  },
  heading3: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: '600',
    marginTop: 16,
    marginBottom: 8,
    lineHeight: 24,
  },
  paragraph: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 26,
    marginTop: 0,
    marginBottom: 12,
  },
  strong: {
    color: colors.textPrimary,
    fontWeight: '600',
  },
  em: {
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
  link: {
    color: colors.primary,
    textDecorationLine: 'none',
  },
  blockquote: {
    backgroundColor: colors.glass,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
    paddingLeft: 16,
    paddingVertical: 12,
    marginVertical: 12,
    borderRadius: borderRadius.sm,
  },
  code_inline: {
    backgroundColor: colors.codeBackground,
    color: colors.primary,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 14,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  fence: {
    backgroundColor: colors.codeBackground,
    borderRadius: borderRadius.md,
    marginVertical: 12,
    borderWidth: 1,
    borderColor: colors.codeBorder,
    overflow: 'hidden',
  },
  bullet_list: {
    marginVertical: 8,
  },
  ordered_list: {
    marginVertical: 8,
  },
  list_item: {
    flexDirection: 'row',
    marginVertical: 4,
  },
  bullet_list_icon: {
    color: colors.textTertiary,
    fontSize: 16,
    marginRight: 12,
    width: 8,
  },
  ordered_list_icon: {
    color: colors.textTertiary,
    fontSize: 16,
    marginRight: 12,
    fontWeight: '500',
  },
  table: {
    borderWidth: 1,
    borderColor: colors.glassBorder,
    borderRadius: borderRadius.md,
    marginVertical: 12,
    overflow: 'hidden',
  },
  thead: {
    backgroundColor: colors.glass,
  },
  th: {
    padding: 12,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.glassBorder,
  },
  tr: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderColor: colors.glassBorder,
  },
  td: {
    padding: 12,
    borderRightWidth: 1,
    borderColor: colors.glassBorder,
  },
  hr: {
    backgroundColor: colors.divider,
    height: 1,
    marginVertical: 20,
  },
  textgroup: {
    color: colors.textPrimary,
  },
  text: {
    color: colors.textPrimary,
  },
}));

export const renderRules: RenderRules = {
  fence: (node: any) => {
    const language = node.sourceInfo || '';
    const code = node.content || '';
    return (
      <CodeBlock key={node.key} language={language}>
        {code}
      </CodeBlock>
    );
  },
  code_block: (node: any) => {
    const code = node.content || '';
    return (
      <CodeBlock key={node.key}>
        {code}
      </CodeBlock>
    );
  },
};

// Shared parser for all bubbles. typographer (and linkify) stay OFF as
// defense-in-depth: both rules have a history of quadratic-complexity
// advisories (GHSA-6v5v-wf23-fmfq, GHSA-22p9-wv53-3rq4 — patched by the
// pinned markdown-it >=14.3), rendered text includes model output and
// user-pasted content, and neither rule is needed for chat rendering.
const markdownParser = MarkdownIt();

/**
 * Render message content with full LaTeX/math support.
 * All math is converted to Unicode inline before Markdown rendering,
 * so text flow is never broken by block-level Views.
 * Exported so StreamingBubble renders the live stream identically (it adds
 * the typing cursor itself via sanitizeStreamingMarkdown, so the cursor
 * lands inside an open code fence rather than after its closing ```).
 */
export function renderContentWithMath(content: string, options?: { muted?: boolean }) {
  return <MathMarkdown content={content} muted={options?.muted} />;
}

// Thin component so the markdown styles follow the active theme (hooks
// can't run inside the plain render helper above).
function MathMarkdown({ content, muted }: { content: string; muted?: boolean }) {
  const baseStyles = useMarkdownStyles();
  const { colors } = useTheme();
  // Muted (reasoning traces): same markdown, smaller secondary-coloured text.
  const markdownStyles = useMemo(() => {
    if (!muted) return baseStyles;
    const toned = Object.fromEntries(
      Object.entries(baseStyles).map(([key, style]) => [
        key,
        (style as { color?: string }).color === colors.textPrimary ? { ...(style as object), color: colors.textSecondary } : style,
      ]),
    ) as typeof baseStyles;
    return { ...toned, body: { ...toned.body, fontSize: 14, lineHeight: 22 } };
  }, [muted, baseStyles, colors]);
  const processed = useMemo(() => preprocessMath(content), [content]);
  return (
    <Markdown style={markdownStyles} rules={renderRules} markdownit={markdownParser}>
      {processed}
    </Markdown>
  );
}
