import { memo, isValidElement, useState, type ReactElement, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Renders model output as markdown (GitHub-flavoured: tables, lists, code).
 * Raw HTML in the text is not rendered, so model output can't inject markup;
 * links open in a new tab without access to this page.
 */

/** The plain text inside rendered children. */
export function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement(node)) return textOf((node as ReactElement<{ children?: ReactNode }>).props.children);
  return '';
}

/** A code block with its language and a copy button. */
function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const code = isValidElement(children) ? (children as ReactElement<{ className?: string; children?: ReactNode }>) : null;
  const language = /language-([\w+#.-]+)/.exec(code?.props.className ?? '')?.[1];

  async function copy() {
    try {
      await navigator.clipboard.writeText(textOf(code?.props.children).replace(/\n$/, ''));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked: the text can still be selected.
    }
  }

  return (
    <div className="code">
      <div className="code-head">
        <span>{language ?? 'code'}</span>
        <button type="button" className="code-copy" onClick={() => void copy()} aria-label="Copy code">{copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy</>}</button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

const components: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
  ),
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
};

const plugins = [remarkGfm];

export const Markdown = memo(function Markdown({ text, muted = false }: { text: string; muted?: boolean }) {
  return (
    <div className={muted ? 'md muted' : 'md'}>
      <ReactMarkdown remarkPlugins={plugins} components={components}>{text}</ReactMarkdown>
    </div>
  );
});
