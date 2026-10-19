import { useEffect, useState, type KeyboardEvent, type RefObject } from 'react';
import type { CodeSession } from '../../agent/session';

/** `@` and some letters just before the cursor, at the start of a word. */
const TOKEN = /(^|\s)@([^\s@]{0,100})$/;

/**
 * The @ file picker: typing @ in Code mode lists the project's files matching what follows, and choosing one writes
 * its path into the message, so the model knows which file is meant (and reads it first).
 */
export function useMentions({ code, input, setInput, inputRef }: { code: CodeSession | null; input: string; setInput: (value: string) => void; inputRef: RefObject<HTMLTextAreaElement | null> }) {
  const [caret, setCaret] = useState(0);
  const [items, setItems] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [closedAt, setClosedAt] = useState(-1);
  const match = code ? TOKEN.exec(input.slice(0, caret)) : null;
  const start = match ? caret - match[2].length - 1 : -1;
  const query = match ? match[2] : null;
  const active = query !== null && closedAt !== start;

  useEffect(() => {
    if (!active || !code) return setItems([]);
    let current = true;
    const timer = setTimeout(() => void code.files(query!).then(list => { if (current) { setItems(list); setIndex(0); } }), 100);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [active, query, code]);

  function choose(file: string) {
    const text = `${input.slice(0, start)}@${file} ${input.slice(caret)}`;
    const at = start + file.length + 2;
    setInput(text);
    setItems([]);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(at, at);
      setCaret(at);
    });
  }

  /** Arrow keys, Enter, Tab and Escape while the list is open. Returns true if the key was used. */
  function onKey(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
    if (!active || !items.length) return false;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      setIndex(i => (i + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length);
    } else if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') choose(items[index]);
    else if (event.key === 'Escape') setClosedAt(start);
    else return false;
    event.preventDefault();
    return true;
  }

  return { items: active ? items : [], index, setIndex, choose, onKey, track: (element: HTMLTextAreaElement) => setCaret(element.selectionStart) };
}
