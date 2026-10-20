import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { CHAT_LIMIT, highlight, type Lines, type Token } from './highlight';
import type { Language } from './languages';

/**
 * Code with its colours. While a reply streams, the code is coloured again at most every EVERY ms; what arrived since is
 * shown plain after the coloured part, so nothing flickers. Plain text until the first colouring, and when there's none.
 */

const EVERY = 250;

interface Done { code: string; language: Language; lines: Lines }

export function useHighlight(code: string, language: Language | null, limit = CHAT_LIMIT): Done | null {
  const [done, setDone] = useState<Done | null>(null);
  const last = useRef(0);

  useEffect(() => {
    if (!language) return;
    const wait = Math.max(0, EVERY - (Date.now() - last.current));
    const timer = setTimeout(() => {
      last.current = Date.now();
      void highlight(code, language, limit).then(lines => {
        if (!lines) return;
        // A slow pass must not replace a newer, longer one.
        setDone(previous => (previous && previous.language === language && previous.code.length > code.length && previous.code.startsWith(code) ? previous : { code, language, lines }));
      });
    }, wait);
    return () => clearTimeout(timer);
  }, [code, language, limit]);

  return done && done.language === language && code.startsWith(done.code) ? done : null;
}

/** One token: a span with its role's class, or the bare text when it has none. */
function TokenText({ token }: { token: Token }) {
  if (!token.role && !token.italic && !token.bold) return <>{token.text}</>;
  const className = [token.role && `syn-${token.role}`, token.italic && 'syn-i', token.bold && 'syn-b'].filter(Boolean).join(' ');
  return <span className={className}>{token.text}</span>;
}

/** A line of tokens, for views that draw their own lines (the file panel). */
export function LineTokens({ tokens }: { tokens: Token[] }): ReactNode {
  return tokens.map((token, index) => <TokenText key={index} token={token} />);
}

export function CodeText({ code, language }: { code: string; language: Language | null }) {
  const done = useHighlight(code, language);
  if (!done) return <>{code}</>;
  return (
    <>
      {done.lines.map((line, index) => (
        <Fragment key={index}>
          {index > 0 && '\n'}
          <LineTokens tokens={line} />
        </Fragment>
      ))}
      {code.slice(done.code.length)}
    </>
  );
}
