import { FileText, X } from 'lucide-react';
import type { Attachment } from '../chat/types';

/** Attachments waiting to be sent, above the message box. */
export function AttachmentChips({ items, onRemove }: { items: Attachment[]; onRemove: (id: string) => void }) {
  if (!items.length) return null;
  return (
    <div className="chips-row" aria-label="Attachments">
      {items.map(item => (
        <span key={item.id} className="attach-chip">
          {item.kind === 'image' && item.dataUrl
            ? <img src={item.dataUrl} alt="" />
            : <span className="attach-icon"><FileText size={15} /></span>}
          <span className="attach-name" title={item.name}>{item.name}</span>
          <button type="button" className="attach-remove" onClick={() => onRemove(item.id)} aria-label={`Remove ${item.name}`}><X size={13} /></button>
        </span>
      ))}
    </div>
  );
}

/** Attachments inside a sent message. */
export function MessageAttachments({ items }: { items: Attachment[] }) {
  if (!items.length) return null;
  return (
    <div className="msg-attachments">
      {items.map(item => item.omitted
        ? (
          <span key={item.id} className="msg-file" title="Photos and files stay on the device they were added on">
            <FileText size={16} />
            <span className="attach-name">{item.name}</span>
            <small>on another device</small>
          </span>
        )
        : item.kind === 'image' && item.dataUrl
        ? <img key={item.id} className="msg-image" src={item.dataUrl} alt={item.name} width={item.width} height={item.height} />
        : (
          <span key={item.id} className="msg-file">
            <FileText size={16} />
            <span className="attach-name" title={item.name}>{item.name}</span>
            <small>{Math.max(1, Math.round((item.text?.length ?? 0) / 1000))}K characters</small>
          </span>
        ))}
    </div>
  );
}
