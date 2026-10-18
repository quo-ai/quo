import { newId, type Attachment } from './chat/types';

/**
 * Reading files the user attaches. Images are shrunk to a JPEG (a phone photo
 * is several megabytes and the model doesn't need them); PDFs and text files
 * become text. Everything happens on this device.
 */

export class AttachmentError extends Error {}

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_DOCUMENT_CHARS = 300_000;
const MAX_IMAGE_SIDE = 1024;
export const MAX_ATTACHMENTS = 4;

const TEXT_EXTENSIONS = 'txt md markdown csv tsv json jsonl xml html htm yaml yml toml ini log js jsx ts tsx py rb go rs java kt swift c h cc cpp hpp cs php sh bash sql css scss tex srt vtt'.split(' ');
const TEXT_PATTERN = new RegExp(`\\.(${TEXT_EXTENSIONS.join('|')})$`, 'i');

/** For the file picker's `accept`. */
export const ACCEPT_DOCUMENTS = ['application/pdf', 'text/*', ...TEXT_EXTENSIONS.map(ext => `.${ext}`)].join(',');
export const ACCEPT_IMAGES = 'image/png,image/jpeg,image/webp,image/gif';

const isPdf = (file: File) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
const isImage = (file: File) => file.type.startsWith('image/');
const isText = (file: File) => file.type.startsWith('text/') || TEXT_PATTERN.test(file.name);

async function readImage(file: File): Promise<Pick<Attachment, 'dataUrl' | 'width' | 'height'>> {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new AttachmentError('That image format isn’t supported. Try a JPEG or PNG.');
  });
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#fff'; // transparent PNGs would turn black as JPEGs
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.85), width, height };
}

async function readPdf(file: File): Promise<string> {
  // Loaded only when a PDF is attached: it's a sizeable library.
  const pdfjs = await import('pdfjs-dist');
  const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const document = await task.promise.catch(() => {
    throw new AttachmentError('That PDF couldn’t be opened. It may be damaged or password protected.');
  });
  const pages: string[] = [];
  let length = 0;
  for (let number = 1; number <= document.numPages && length < MAX_DOCUMENT_CHARS; number++) {
    const content = await (await document.getPage(number)).getTextContent();
    let text = '';
    for (const item of content.items) {
      if ('str' in item) text += item.str + (item.hasEOL ? '\n' : '');
    }
    pages.push(text.trim());
    length += text.length;
  }
  await task.destroy();
  return pages.join('\n\n');
}

async function readText(file: File): Promise<string> {
  const text = await file.text();
  if (text.slice(0, 4096).includes('\0')) throw new AttachmentError(`${file.name} looks like a binary file, not text.`);
  return text;
}

/** Reads one file into an attachment, or throws an AttachmentError saying why not. */
export async function readAttachment(file: File, options: { images: boolean }): Promise<Attachment> {
  if (file.size > MAX_FILE_BYTES) throw new AttachmentError(`${file.name} is too big (the limit is ${MAX_FILE_BYTES / 1024 / 1024} MB).`);

  if (isImage(file)) {
    if (!options.images) throw new AttachmentError('The model you’re using can’t read images. Pick one marked as reading images.');
    return { id: newId(), kind: 'image', name: file.name, ...(await readImage(file)) };
  }
  if (isPdf(file) || isText(file)) {
    const raw = (isPdf(file) ? await readPdf(file) : await readText(file)).replace(/\r\n/g, '\n').trim();
    if (!raw) throw new AttachmentError(`No text found in ${file.name}. If it’s a scanned document, it’s only a picture of text.`);
    return { id: newId(), kind: 'document', name: file.name, text: raw.length > MAX_DOCUMENT_CHARS ? raw.slice(0, MAX_DOCUMENT_CHARS) : raw };
  }
  throw new AttachmentError(`Quo can’t read ${file.name} yet. It reads images, PDFs and text files.`);
}
