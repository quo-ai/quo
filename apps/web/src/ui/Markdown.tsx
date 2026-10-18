import { memo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Renders model output as markdown (GitHub-flavoured: tables, lists, code).
 * Raw HTML in the text is not rendered, so model output can't inject markup;
 * links open in a new tab without access to this page.
 */

const components: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
  ),
};

const plugins = [remarkGfm];

export const Markdown = memo(function Markdown({ text, muted = false }: { text: string; muted?: boolean }) {
  return (
    <div className={muted ? 'md muted' : 'md'}>
      <ReactMarkdown remarkPlugins={plugins} components={components}>{text}</ReactMarkdown>
    </div>
  );
});
