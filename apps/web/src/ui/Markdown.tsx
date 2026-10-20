import { memo, isValidElement, useState, type ReactElement, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { codePanel, useFileExists } from '../agent/codePanel';
import { fileRefFromHref, parseFileRef, type FileRef } from '../agent/fileRefs';
import { CodeText } from '../code/CodeText';
import { languageOf } from '../code/languages';
import { hasMath, normalizeMath } from '../math/normalize';
import { useMath } from '../math/useMath';

/**
 * Renders model output as markdown (GitHub-flavoured: tables, lists, code), with code coloured (code/) and maths drawn
 * by KaTeX (math/), each loaded the first time a reply needs it. Raw HTML in the text is not rendered, so model output
 * can't inject markup; links open in a new tab without access to this page.
 */

/** The plain text inside rendered children. */
export function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement(node)) return textOf((node as ReactElement<{ children?: ReactNode }>).props.children);
  return '';
}

/** A code block with its language, its colours and a copy button. */
function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const code = isValidElement(children) ? (children as ReactElement<{ className?: string; children?: ReactNode }>) : null;
  const language = /language-([\w+#.-]+)/.exec(code?.props.className ?? '')?.[1];
  const text = textOf(code?.props.children);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text.replace(/\n$/, ''));
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
      <pre><code className={code?.props.className}><CodeText code={text} language={languageOf(language)} /></code></pre>
    </div>
  );
}

/**
 * A path the agent named. It becomes a link to look inside the file only once the project confirms it is a real file there
 * (so "node.js" in a sentence stays text); until then, and for anything else, it is drawn as it would have been.
 */
function FileMention({ file, inline, children, fallback }: { file: FileRef; inline: boolean; children: ReactNode; fallback: ReactNode }) {
  const exists = useFileExists(file.path);
  if (!exists) return <>{fallback}</>;
  const open = (event: { preventDefault: () => void }) => {
    event.preventDefault();
    codePanel.openFile(file.path, file.line);
  };
  return inline
    ? <code className="file-link" role="link" tabIndex={0} title="Look inside in the file panel" onClick={open} onKeyDown={event => event.key === 'Enter' && open(event)}>{children}</code>
    : <a className="file-link" href="#" title="Look inside in the file panel" onClick={open}>{children}</a>;
}

const components: Components = {
  a: ({ href, children }) => {
    const file = fileRefFromHref(href);
    const plain = <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
    return file ? <FileMention file={file} inline={false} fallback={plain}>{children}</FileMention> : plain;
  },
  code: ({ className, children }) => {
    const text = textOf(children);
    const file = !className && !text.includes('\n') ? parseFileRef(text) : null;
    const plain = <code className={className}>{children}</code>;
    return file ? <FileMention file={file} inline fallback={plain}>{children}</FileMention> : plain;
  },
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
};

const plugins = [remarkGfm];

export const Markdown = memo(function Markdown({ text, muted = false }: { text: string; muted?: boolean }) {
  const math = useMath(hasMath(text));
  return (
    <div className={muted ? 'md muted' : 'md'}>
      {math
        ? <ReactMarkdown remarkPlugins={[remarkGfm, math.remark]} rehypePlugins={[math.rehype]} components={components}>{normalizeMath(text)}</ReactMarkdown>
        : <ReactMarkdown remarkPlugins={plugins} components={components}>{text}</ReactMarkdown>}
    </div>
  );
});
