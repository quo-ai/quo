import { useEffect, useState, type DragEvent } from 'react';
import { AttachmentError, MAX_ATTACHMENTS, readAttachment } from '../../attachments';
import type { Attachment } from '../../chat/types';
import { toast } from '../Toasts';

/** Files attached to the message being written, by picking or dragging. They are read on this device and only go to offline models. */
export function useAttachments({ enabled, vision, resetKey }: { enabled: boolean; vision: boolean; resetKey: unknown }) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragging, setDragging] = useState(false);

  useEffect(() => setAttachments([]), [resetKey]);

  async function attach(files: FileList | File[]) {
    if (!enabled) return;
    for (const file of Array.from(files)) {
      if (attachments.length >= MAX_ATTACHMENTS) return void toast(`You can attach up to ${MAX_ATTACHMENTS} files at a time.`);
      try {
        const attachment = await readAttachment(file, { images: vision });
        setAttachments(list => (list.length >= MAX_ATTACHMENTS ? list : [...list, attachment]));
      } catch (error) {
        toast(error instanceof AttachmentError ? error.message : `Couldn’t read ${file.name}.`);
      }
    }
  }

  const dropTarget = {
    onDragOver: (event: DragEvent) => {
      if (enabled) {
        event.preventDefault();
        setDragging(true);
      }
    },
    onDragLeave: () => setDragging(false),
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      setDragging(false);
      if (event.dataTransfer.files.length) void attach(event.dataTransfer.files);
    },
  };

  return {
    attachments,
    dragging,
    attach,
    dropTarget,
    remove: (id: string) => setAttachments(list => list.filter(item => item.id !== id)),
    clear: () => setAttachments([]),
  };
}
