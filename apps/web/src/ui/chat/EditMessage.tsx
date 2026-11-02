import { useEffect, useRef, useState } from 'react';
import { CornerDownLeft } from 'lucide-react';

interface EditMessageProps {
  initial: string;
  /** Messages after this one, which sending removes. */
  later: number;
  onCancel: () => void;
  onSend: (text: string) => void;
}

/**
 * Editing a message you sent, in place of its bubble. Sending goes on from there with the new text (and its files): the
 * messages after it are removed, as the line under the box says. Enter sends and Shift+Enter adds a line, as in the
 * message box; Esc cancels.
 */
export function EditMessage({ initial, later, onCancel, onSend }: EditMessageProps) {
  const [text, setText] = useState(initial);
  const area = useRef<HTMLTextAreaElement>(null);

  const fit = () => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  };
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    fit();
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const canSend = text.trim() !== '';
  const send = () => {
    if (canSend) onSend(text.trim());
  };

  return (
    <div className="edit-message">
      <textarea
        ref={area}
        value={text}
        rows={1}
        aria-label="Edit your message"
        onChange={event => {
          setText(event.target.value);
          fit();
        }}
        onKeyDown={event => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          } else if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            send();
          }
        }}
      />
      <div className="edit-foot">
        <span className="note">{later > 0 ? `Sending removes the ${later} message${later === 1 ? '' : 's'} after this one.` : 'Sending asks again from here.'}</span>
        <button type="button" className="btn btn-ghost press" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn btn-glass press" disabled={!canSend} onClick={send}><CornerDownLeft size={15} /> Send</button>
      </div>
    </div>
  );
}
