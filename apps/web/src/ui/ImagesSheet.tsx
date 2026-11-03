import { useEffect, useRef } from 'react';
import { Download, MessageSquare, X } from 'lucide-react';
import type { Conversation, GeneratedImage } from '../chat/types';
import { Facts } from './Facts';

export interface MadeImage {
  image: GeneratedImage & { dataUrl: string };
  chat: { id: string; title: string };
}

/** Every image made on this device, newest first: chats by when they changed, and within a chat, last made first. */
export function imagesIn(conversations: Conversation[]): MadeImage[] {
  return [...conversations]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .flatMap(chat => chat.messages
      .flatMap(message => message.images ?? [])
      .filter((image): image is MadeImage['image'] => image.status === 'done' && typeof image.dataUrl === 'string')
      .reverse()
      .map(image => ({ image, chat: { id: chat.id, title: chat.title } })));
}

const extension = (dataUrl: string) => /^data:image\/(png|jpeg|webp)/.exec(dataUrl)?.[1]?.replace('jpeg', 'jpg') ?? 'png';

/**
 * The images tab: everything Quo made, across chats, to look at again, save, or go back to the chat it came from. A new
 * image is made in a chat (ask for one, or type /image), so it follows that chat's model: on this computer for an offline
 * chat with an image model, in the cloud otherwise.
 */
export function ImagesSheet({ conversations, onOpenChat, onClose }: { conversations: Conversation[]; onOpenChat: (id: string) => void; onClose: () => void }) {
  const sheet = useRef<HTMLDivElement>(null);
  const images = imagesIn(conversations);

  useEffect(() => {
    sheet.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="scrim" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="sheet glass thick images-sheet" role="dialog" aria-modal="true" aria-labelledby="images-title" tabIndex={-1} ref={sheet}>
        <div className="sheet-head">
          <h2 id="images-title">Images</h2>
          <button className="icon-btn round press" onClick={onClose} aria-label="Close"><X size={19} /></button>
        </div>
        <div className="sheet-body">
          <p className="note">To make one, ask for a picture in any chat, or type /image and what it should show. Images stay on this device and aren’t synced.</p>
          {images.length === 0 ? (
            <p className="images-empty">No images yet.</p>
          ) : (
            <div className="image-grid">
              {images.map(({ image, chat }, index) => (
                <figure key={`${chat.id}-${image.id}`} className="image-tile">
                  <img src={image.dataUrl} alt={image.prompt} loading="lazy" />
                  <figcaption>
                    <span className="image-prompt" title={image.prompt}>{image.prompt}</span>
                    <span className="image-facts"><Facts items={[image.model ?? null, image.where === 'device' ? 'On this computer' : 'In the cloud']} /></span>
                    <span className="image-actions">
                      <button type="button" className="btn btn-ghost press" onClick={() => { onClose(); onOpenChat(chat.id); }} title={`Open “${chat.title}”`}><MessageSquare size={14} /> Chat</button>
                      <a className="icon-btn press" href={image.dataUrl} download={`quo-image-${index + 1}.${extension(image.dataUrl)}`} aria-label="Save image" title="Save image"><Download size={15} /></a>
                    </span>
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
