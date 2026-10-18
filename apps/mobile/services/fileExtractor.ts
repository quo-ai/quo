import {
  readAsStringAsync,
  copyAsync,
  deleteAsync,
  getInfoAsync,
  cacheDirectory,
} from 'expo-file-system/legacy';
import { Platform } from 'react-native';

// Conditional import for native PDF extraction (requires dev build)
let nativeExtractText: ((uri: string) => Promise<string[]>) | null = null;
let nativeIsAvailable: (() => boolean) | null = null;

try {
  const pdfModule = require('expo-pdf-text-extract');
  nativeExtractText = pdfModule.extractText;
  nativeIsAvailable = pdfModule.isAvailable;
} catch {
  // expo-pdf-text-extract not available (e.g. web or Expo Go)
}

// Maximum characters to extract from a document.
// This is now set to 1,000,000 to allow the token-aware dynamic budget in ChatContext
// to handle the actual truncation based on the model's exact context configuration.
const MAX_EXTRACT_CHARS = 1000000;

// Refuse documents larger than this outright (matches the picker-side cap in
// hooks/useAttachments.ts). Native PDF extraction loads the whole document.
const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

// Plain-text files are read at most this many bytes (UTF-8 is <= 4 bytes per
// char, so this always covers MAX_EXTRACT_CHARS). Larger files are clipped.
const MAX_TEXT_READ_BYTES = 4 * MAX_EXTRACT_CHARS;

// The regex PDF fallback works on a base64 → binary string copy of the file
// (~2.3x its size in JS memory); only scan the head of large PDFs.
const MAX_PDF_FALLBACK_READ_BYTES = 8 * 1024 * 1024;

// MIME types we can extract text from
const TEXT_MIME_TYPES = [
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
  'text/xml',
  'text/json',
  'application/json',
  'application/xml',
  'application/csv',
  'text/tab-separated-values',
];

const PDF_MIME_TYPES = [
  'application/pdf',
];

// File extensions we treat as plain text (fallback when MIME is generic)
const TEXT_EXTENSIONS = [
  '.txt', '.md', '.csv', '.json', '.xml', '.html', '.htm',
  '.log', '.yml', '.yaml', '.toml', '.ini', '.cfg', '.conf',
  '.sh', '.bat', '.ps1', '.py', '.js', '.ts', '.jsx', '.tsx',
  '.java', '.c', '.cpp', '.h', '.hpp', '.cs', '.rb', '.go',
  '.rs', '.swift', '.kt', '.sql', '.r', '.m', '.tex',
  '.env', '.gitignore', '.dockerfile',
];

/**
 * Check if a file is supported for text extraction
 */
export function isSupportedFileType(mimeType: string, fileName: string): boolean {
  const mime = mimeType.toLowerCase();
  const ext = getExtension(fileName);

  if (TEXT_MIME_TYPES.includes(mime)) return true;
  if (PDF_MIME_TYPES.includes(mime)) return true;
  if (mime === 'application/octet-stream' && TEXT_EXTENSIONS.includes(ext)) return true;
  if (TEXT_EXTENSIONS.includes(ext)) return true;

  return false;
}

/**
 * Get a human-readable file type label
 */
export function getFileTypeLabel(mimeType: string, fileName: string): string {
  const mime = mimeType.toLowerCase();
  const ext = getExtension(fileName).replace('.', '').toUpperCase();

  if (PDF_MIME_TYPES.includes(mime)) return 'PDF';
  if (mime === 'text/csv' || mime === 'application/csv') return 'CSV';
  if (mime === 'application/json' || mime === 'text/json') return 'JSON';
  if (mime === 'text/markdown') return 'Markdown';
  if (mime === 'text/html') return 'HTML';
  if (mime === 'text/xml' || mime === 'application/xml') return 'XML';
  if (ext) return ext;
  return 'Document';
}

/**
 * Extract text content from a document file.
 * Supports plain text files and PDFs (native extraction via expo-pdf-text-extract,
 * with a regex fallback for environments where the native module is unavailable).
 */
export async function extractTextFromFile(
  uri: string,
  mimeType: string,
  fileName: string,
): Promise<string> {
  const mime = mimeType.toLowerCase();
  const ext = getExtension(fileName);

  const size = await getFileSize(uri);
  if (size !== undefined && size > MAX_DOCUMENT_BYTES) {
    throw new Error(
      `This file is too large to read (${Math.round(size / (1024 * 1024))} MB). ` +
      `Please attach a file under ${MAX_DOCUMENT_BYTES / (1024 * 1024)} MB.`,
    );
  }

  // PDF extraction
  if (PDF_MIME_TYPES.includes(mime) || ext === '.pdf') {
    return extractTextFromPdf(uri, fileName, size);
  }

  // Plain text extraction (all text-based formats)
  return extractPlainText(uri, size);
}

/** File size in bytes, or undefined if it can't be determined. */
async function getFileSize(uri: string): Promise<number | undefined> {
  try {
    const info = await getInfoAsync(uri);
    return info.exists && typeof info.size === 'number' ? info.size : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Number of trailing bytes in `tail` that form an incomplete UTF-8 sequence
 * (0 if the buffer ends on a character boundary). `tail` must be the last
 * bytes of the range being read (up to 4 is enough).
 */
export function incompleteUtf8TailLength(tail: ArrayLike<number>): number {
  // Walk back over continuation bytes (10xxxxxx) to the lead byte.
  for (let back = 1; back <= Math.min(4, tail.length); back++) {
    const byte = tail[tail.length - back];
    if ((byte & 0xc0) === 0x80) continue; // continuation byte
    let needed = 1;
    if ((byte & 0xe0) === 0xc0) needed = 2;
    else if ((byte & 0xf0) === 0xe0) needed = 3;
    else if ((byte & 0xf8) === 0xf0) needed = 4;
    return needed > back ? back : 0;
  }
  return 0;
}

/**
 * Read up to `maxBytes` of a UTF-8 file without splitting a multi-byte
 * character (iOS fails the whole read on a truncated sequence).
 */
async function readUtf8Head(uri: string, maxBytes: number): Promise<string> {
  const tailLen = 4;
  const tailB64 = await readAsStringAsync(uri, {
    encoding: 'base64',
    position: maxBytes - tailLen,
    length: tailLen,
  });
  const tailBin = atob(tailB64);
  const tail = Array.from(tailBin, ch => ch.charCodeAt(0));
  const length = maxBytes - incompleteUtf8TailLength(tail);
  return readAsStringAsync(uri, { encoding: 'utf8', position: 0, length });
}

/**
 * Read a file as UTF-8 text. Files over MAX_TEXT_READ_BYTES are clipped at
 * read time so a huge log/CSV can't OOM the JS heap.
 */
async function extractPlainText(uri: string, size: number | undefined): Promise<string> {
  try {
    if (size !== undefined && size > MAX_TEXT_READ_BYTES) {
      const head = await readUtf8Head(uri, MAX_TEXT_READ_BYTES);
      return truncate(head, true);
    }
    const content = await readAsStringAsync(uri, {
      encoding: 'utf8',
    });
    return truncate(content);
  } catch (error) {
    console.error('[FileExtractor] Failed to read text file:', error);
    throw new Error('Could not read this file. It may be in an unsupported format.');
  }
}

/**
 * Convert a content:// URI (Android document provider) to a local file:// path
 * that native modules can read. Returns the original URI on iOS or if it's
 * already a file path.
 */
async function ensureLocalPath(
  uri: string,
  fileName: string,
): Promise<{ path: string; tempCopy: boolean }> {
  if (Platform.OS !== 'android' || !uri.startsWith('content://')) {
    return { path: uri, tempCopy: false };
  }

  try {
    const safeName = fileName.replace(/[^\w.-]/g, '_');
    const localPath = `${cacheDirectory}doc_${Date.now()}_${safeName}`;
    await copyAsync({ from: uri, to: localPath });
    return { path: localPath, tempCopy: true };
  } catch (error) {
    console.warn('[FileExtractor] Could not copy content:// URI, using original:', error);
    return { path: uri, tempCopy: false };
  }
}

/**
 * Extract text from a PDF file.
 *
 * Primary: Uses expo-pdf-text-extract which leverages native platform APIs
 * (iOS PDFKit, Android PDFBox) for reliable extraction from compressed streams,
 * font encodings, and multi-page documents.
 *
 * Fallback: A lightweight regex-based parser that reads raw PDF bytes. This
 * handles uncompressed text-heavy PDFs but cannot decompress FlateDecode
 * streams (used by most modern PDF generators).
 */
async function extractTextFromPdf(
  uri: string,
  fileName: string,
  size: number | undefined,
): Promise<string> {
  // Try native extraction first (much more reliable)
  if (nativeIsAvailable?.() && nativeExtractText) {
    let local: { path: string; tempCopy: boolean } | null = null;
    try {
      // Android content:// URIs may need copying to a local path
      local = await ensureLocalPath(uri, fileName);
      const pages = await nativeExtractText(local.path);
      const fullText = Array.isArray(pages) ? pages.join('\n\n') : String(pages);

      if (!fullText || fullText.trim().length < 20) {
        throw new Error('Could not extract text from this PDF. It may be scanned or image-only.');
      }

      return truncate(fullText);
    } catch (error: any) {
      if (error.message?.includes('Could not extract')) throw error;
      console.warn('[FileExtractor] Native PDF extraction failed, trying fallback:', error);
      // Fall through to regex-based parser
    } finally {
      if (local?.tempCopy) {
        deleteAsync(local.path, { idempotent: true }).catch(() => {});
      }
    }
  }

  // Fallback: regex-based parser for uncompressed PDFs
  return extractTextFromPdfFallback(uri, size);
}

/**
 * Fallback PDF text extraction using regex on raw bytes.
 * Only works for PDFs with uncompressed content streams (BT/ET blocks).
 * Most modern PDFs use FlateDecode compression which this cannot handle.
 */
async function extractTextFromPdfFallback(uri: string, size: number | undefined): Promise<string> {
  try {
    // Read PDF as base64, then decode to work with raw bytes. Large files are
    // clipped to their head (unknown size → also clipped; reading past EOF is safe).
    const clip = size === undefined || size > MAX_PDF_FALLBACK_READ_BYTES;
    const base64 = await readAsStringAsync(uri, {
      encoding: 'base64',
      ...(clip ? { position: 0, length: MAX_PDF_FALLBACK_READ_BYTES } : {}),
    });
    const raw = atob(base64);

    const textParts: string[] = [];

    // Strategy 1: Extract text from BT...ET blocks (text objects)
    // These contain Tj (show string) and TJ (show array) operators
    const btEtRegex = /BT\s([\s\S]*?)ET/g;
    let btMatch;
    while ((btMatch = btEtRegex.exec(raw)) !== null) {
      const block = btMatch[1];
      // Extract Tj strings: (text) Tj
      const tjRegex = /\(([^)]*)\)\s*Tj/g;
      let tjMatch;
      while ((tjMatch = tjRegex.exec(block)) !== null) {
        const decoded = decodePdfString(tjMatch[1]);
        if (decoded.trim()) textParts.push(decoded);
      }
      // Extract TJ arrays: [(text) -kern (text)] TJ
      const tjArrayRegex = /\[((?:\([^)]*\)|[^\]])*)]\s*TJ/gi;
      let tjArrMatch;
      while ((tjArrMatch = tjArrayRegex.exec(block)) !== null) {
        const arrContent = tjArrMatch[1];
        const strRegex = /\(([^)]*)\)/g;
        let strMatch;
        const parts: string[] = [];
        while ((strMatch = strRegex.exec(arrContent)) !== null) {
          parts.push(decodePdfString(strMatch[1]));
        }
        if (parts.length > 0) textParts.push(parts.join(''));
      }
    }

    // Strategy 2: If BT/ET extraction yielded very little, try stream decompression markers
    if (textParts.join('').trim().length < 50) {
      // Look for readable ASCII strings in the raw content
      const readableRegex = /\(([A-Za-z0-9 .,;:!?'"()\-\/@#$%^&*+=\[\]{}|\\~`<>]{4,})\)/g;
      let readMatch;
      while ((readMatch = readableRegex.exec(raw)) !== null) {
        textParts.push(decodePdfString(readMatch[1]));
      }
    }

    let extracted = textParts.join(' ')
      .replace(/\s+/g, ' ')
      .replace(/(\w)- (\w)/g, '$1$2') // Rejoin hyphenated words
      .trim();

    if (!extracted || extracted.length < 20) {
      throw new Error('Could not extract text from this PDF. It may be scanned or image-only.');
    }

    return truncate(extracted);
  } catch (error: any) {
    if (error.message?.includes('Could not extract')) throw error;
    console.error('[FileExtractor] PDF extraction failed:', error);
    throw new Error('Could not read this PDF file. It may be corrupted or in an unsupported format.');
  }
}

/** Decode PDF escape sequences in a parenthesized string */
function decodePdfString(s: string): string {
  return s
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\')
    .replace(/\\(\d{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
}

/** Get lowercase file extension including the dot */
function getExtension(fileName: string): string {
  const match = fileName.match(/\.[^.]+$/);
  return match ? match[0].toLowerCase() : '';
}

/** Truncate text to fit within context limits */
function truncate(text: string, clippedAtRead = false): string {
  if (text.length <= MAX_EXTRACT_CHARS && !clippedAtRead) return text;
  return text.slice(0, MAX_EXTRACT_CHARS) + '\n\n[... Document hard-truncated — exceeded maximum 1M character limit]';
}
