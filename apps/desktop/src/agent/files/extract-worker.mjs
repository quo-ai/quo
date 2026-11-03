// Takes the text out of documents (PDF, Word, PowerPoint, Excel, OpenDocument) for Code mode's reading tools. It runs as
// a process of its own (documents.js starts it) under Node's permission model: it can read only its own code, can't write
// a file or start a program, and gets each document's bytes from main, never a path. A document that tries to exploit the
// PDF or zip reader lands here, not in the main process that holds the person's keys.
//
// One JSON message per line on stdin: { id, kind, data (base64) }. One per line back: { id, text } or { id, error }.

import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { strFromU8, unzipSync } from 'fflate';

const MAX_TEXT = 1_000_000;
const MAX_UNZIPPED = 80 * 1024 * 1024;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = text => text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, name) => {
  if (name[0] !== '#') return ENTITIES[name.toLowerCase()];
  const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
  return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
});
/** XML to text: line breaks where `paragraph` ends, tabs where `tab` is, every other tag dropped. */
const xmlText = (xml, { paragraph, tab = null, lineBreak = null }) => decode(xml
  .replace(new RegExp(`</${paragraph}>`, 'g'), '\n')
  .replace(tab ? new RegExp(`<${tab}\\b[^>]*/>`, 'g') : /$^/, '\t')
  .replace(lineBreak ? new RegExp(`<${lineBreak}\\b[^>]*/>`, 'g') : /$^/, '\n')
  .replace(/<[^>]+>/g, ''))
  .replace(/[ \t]+\n/g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

/** The entries of a zip that are wanted, refusing archives that unpack to far more than they should (zip bombs). */
function unzip(bytes, wanted) {
  let total = 0;
  return unzipSync(bytes, {
    filter: file => {
      if (!wanted(file.name)) return false;
      total += file.originalSize;
      if (total > MAX_UNZIPPED) throw new Error('This document unpacks to too much.');
      return true;
    },
  });
}

const byNumber = (a, b) => Number(a.match(/(\d+)\.xml$/)?.[1] ?? 0) - Number(b.match(/(\d+)\.xml$/)?.[1] ?? 0);

function docx(bytes) {
  const files = unzip(bytes, name => /^word\/(document|footnotes|endnotes)\.xml$/.test(name));
  return ['word/document.xml', 'word/footnotes.xml', 'word/endnotes.xml']
    .filter(name => files[name])
    .map(name => xmlText(strFromU8(files[name]), { paragraph: 'w:p', tab: 'w:tab', lineBreak: 'w:br' }))
    .join('\n\n');
}

function pptx(bytes) {
  const files = unzip(bytes, name => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  return Object.keys(files).sort(byNumber).map((name, index) => `Slide ${index + 1}\n${xmlText(strFromU8(files[name]), { paragraph: 'a:p', lineBreak: 'a:br' })}`).join('\n\n');
}

function xlsx(bytes) {
  const files = unzip(bytes, name => name === 'xl/sharedStrings.xml' || name === 'xl/workbook.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
  const shared = files['xl/sharedStrings.xml'] ? [...strFromU8(files['xl/sharedStrings.xml']).matchAll(/<si>([\s\S]*?)<\/si>/g)].map(([, item]) => decode(item.replace(/<[^>]+>/g, ''))) : [];
  const names = files['xl/workbook.xml'] ? [...strFromU8(files['xl/workbook.xml']).matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)].map(([, name]) => decode(name)) : [];
  return Object.keys(files).filter(name => name.startsWith('xl/worksheets/')).sort(byNumber).map((name, index) => {
    const rows = [...strFromU8(files[name]).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map(([, row]) => [...row.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map(([, attributes, inner = '']) => {
      const type = /\bt="([^"]+)"/.exec(attributes)?.[1];
      if (type === 'inlineStr') return decode(inner.replace(/<[^>]+>/g, ''));
      const value = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? '';
      return type === 's' ? shared[Number(value)] ?? '' : decode(value);
    }).join('\t'));
    return `Sheet: ${names[index] ?? index + 1}\n${rows.join('\n')}`;
  }).join('\n\n');
}

function openDocument(bytes) {
  const files = unzip(bytes, name => name === 'content.xml');
  if (!files['content.xml']) throw new Error('This isn’t an OpenDocument file.');
  const xml = strFromU8(files['content.xml']).replace(/<\/table:table-cell>/g, '\t').replace(/<\/table:table-row>/g, '\n');
  return xmlText(xml.replace(/<\/text:h>/g, '</text:p>'), { paragraph: 'text:p', tab: 'text:tab', lineBreak: 'text:line-break' });
}

async function pdf(bytes) {
  // Loaded once, on the first PDF. No scripts from the document (isEvalSupported off), no fonts drawn: text only.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // pdf.js's own character maps, for text in fonts that don't carry them (Chinese, Japanese, Korean).
  const cMapUrl = `${fileURLToPath(new URL('../../cmaps/', import.meta.resolve('pdfjs-dist/legacy/build/pdf.mjs')))}${path.sep}`;
  const task = pdfjs.getDocument({ data: bytes, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, cMapUrl, cMapPacked: true, verbosity: 0 });
  const document = await task.promise.catch(error => {
    throw new Error(/password/i.test(String(error?.name)) ? 'This PDF is password protected.' : 'This PDF couldn’t be opened. It may be damaged.');
  });
  const pages = [];
  let length = 0;
  for (let number = 1; number <= document.numPages && length < MAX_TEXT; number++) {
    const content = await (await document.getPage(number)).getTextContent();
    const text = content.items.map(item => ('str' in item ? item.str + (item.hasEOL ? '\n' : '') : '')).join('').trim();
    pages.push(`Page ${number}\n${text}`);
    length += text.length;
  }
  await task.destroy();
  return pages.join('\n\n');
}

const READERS = { pdf, docx, pptx, xlsx, odf: openDocument };

async function handle(line) {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return;
  }
  try {
    const read = READERS[request.kind];
    if (!read) throw new Error('Quo can’t read this kind of document.');
    const text = (await read(new Uint8Array(Buffer.from(String(request.data), 'base64')))).slice(0, MAX_TEXT);
    process.stdout.write(`${JSON.stringify({ id: request.id, text })}\n`);
  } catch (error) {
    const message = error instanceof Error && /^(This|Quo)/.test(error.message) ? error.message : 'This document couldn’t be read. It may be damaged, or in a form Quo can’t read.';
    process.stdout.write(`${JSON.stringify({ id: request.id, error: message })}\n`);
  }
}

// One at a time, in order: a big PDF doesn't run beside another.
let queue = Promise.resolve();
readline.createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', line => {
  queue = queue.then(() => handle(line));
});
