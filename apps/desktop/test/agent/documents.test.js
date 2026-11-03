'use strict';

// Documents in a project (src/agent/files/documents.js, extract-worker.mjs): PDF, Word, PowerPoint, Excel and OpenDocument
// files are read and searched as text, by a separate process that gets only the bytes and can't write or start anything.
// Tries damaged files, a zip bomb, a reader that hangs, and the old limits (secrets, outside the project).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { after, before, describe, it } = require('node:test');
const { strToU8, zipSync } = require('fflate');
const files = require('../../src/agent/files');
const { DocumentReader, reader } = require('../../src/agent/files/documents');
const { temp, write, rejects, ctxFor } = require('./helpers');

/** A small real PDF: one page per string. */
function pdf(pages) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`];
  const font = 3 + pages.length * 2;
  pages.forEach((text, i) => {
    const stream = `BT /F1 12 Tf 20 150 Td (${text}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Contents ${4 + i * 2} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let out = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(at => `${String(at).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
const zip = entries => Buffer.from(zipSync(Object.fromEntries(Object.entries(entries).map(([name, text]) => [name, typeof text === 'string' ? strToU8(text) : text]))));

const DOCX = zip({ 'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Tenancy agreement</w:t></w:r></w:p><w:p><w:r><w:t>Rent: £950 &amp; bills</w:t><w:tab/><w:t>monthly</w:t></w:r></w:p></w:body></w:document>' });
const PPTX = zip({ 'ppt/slides/slide2.xml': '<p:sld><a:p><a:r><a:t>Second slide</a:t></a:r></a:p></p:sld>', 'ppt/slides/slide1.xml': '<p:sld><a:p><a:r><a:t>Quarterly plan</a:t></a:r></a:p></p:sld>' });
const XLSX = zip({
  'xl/workbook.xml': '<workbook><sheets><sheet name="Budget" sheetId="1"/></sheets></workbook>',
  'xl/sharedStrings.xml': '<sst><si><t>Item</t></si><si><t>Cost</t></si><si><t>Laptop</t></si></sst>',
  'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>1299</v></c></row></sheetData></worksheet>',
});
const ODT = zip({ 'mimetype': 'application/vnd.oasis.opendocument.text', 'content.xml': '<office:document-content><office:body><office:text><text:h>Minutes</text:h><text:p>Decided to move the launch.</text:p></office:text></office:body></office:document-content>' });

describe('documents in a project', () => {
  let root;
  before(() => {
    root = temp();
    write(root, 'contracts/lease.pdf', pdf(['The rent is due on the first day.', 'Notice period: two months.']));
    write(root, 'contracts/agreement.docx', DOCX);
    write(root, 'slides.pptx', PPTX);
    write(root, 'budget.xlsx', XLSX);
    write(root, 'minutes.odt', ODT);
    write(root, 'broken.pdf', 'not really a pdf');
    write(root, 'broken.docx', 'not a zip either');
    write(root, 'notes.md', 'two months of notes\n');
  });
  after(() => reader.stop());

  it('reads each kind as text, in numbered lines like any file', async () => {
    const lease = await files.readFile(ctxFor(root), { path: 'contracts/lease.pdf' });
    assert.match(lease.text, /^contracts\/lease\.pdf \(lines 1-\d+ of \d+, the text of the PDF file\)/);
    assert.match(lease.text, /\d+\tPage 1\n\s*\d+\tThe rent is due on the first day/);
    assert.match(lease.text, /Notice period: two months/);
    assert.equal(lease.display.document, 'pdf');
    assert.match((await files.readFile(ctxFor(root), { path: 'contracts/agreement.docx' })).text, /Tenancy agreement\n\s*\d+\tRent: £950 & bills\tmonthly/);
    assert.match((await files.readFile(ctxFor(root), { path: 'slides.pptx' })).text, /Slide 1\n\s*\d+\tQuarterly plan[\s\S]*Slide 2\n\s*\d+\tSecond slide/);
    assert.match((await files.readFile(ctxFor(root), { path: 'budget.xlsx' })).text, /Sheet: Budget\n\s*\d+\tItem\tCost\n\s*\d+\tLaptop\t1299/);
    assert.match((await files.readFile(ctxFor(root), { path: 'minutes.odt' })).text, /Minutes\n\s*\d+\tDecided to move the launch\./);
  });

  it('searches inside them, beside ordinary files', async () => {
    const result = await files.searchText(ctxFor(root), { pattern: 'two months' });
    assert.match(result.text, /contracts\/lease\.pdf:\d+: Notice period: two months\./);
    assert.match(result.text, /notes\.md:1: two months of notes/);
    assert.match((await files.searchText(ctxFor(root), { pattern: 'laptop' })).text, /budget\.xlsx:\d+: Laptop\t1299/);
  });

  it('says plainly when one is damaged, and the reader carries on', async () => {
    await rejects(files.readFile(ctxFor(root), { path: 'broken.pdf' }), 'document_failed');
    await rejects(files.readFile(ctxFor(root), { path: 'broken.docx' }), 'document_failed');
    assert.match((await files.readFile(ctxFor(root), { path: 'contracts/agreement.docx' })).text, /Tenancy agreement/);
  });

  it('refuses a zip bomb (a document that unpacks to far too much)', async () => {
    write(root, 'bomb.docx', zip({ 'word/document.xml': Buffer.alloc(90 * 1024 * 1024, 0x20) }));
    await assert.rejects(files.readFile(ctxFor(root), { path: 'bomb.docx' }), error => error.code === 'document_failed' && /unpacks to too much/.test(error.message));
  });

  it('keeps the old limits: secrets files and anything outside the project', async () => {
    write(root, 'secrets/credentials.pdf', pdf(['secret']));
    write(root, '.env.docx', DOCX);
    await assert.rejects(files.readFile(ctxFor(root), { path: '.env.docx' }), error => error.code === 'secret');
    await assert.rejects(files.readFile(ctxFor(root), { path: '../outside.pdf' }));
    assert.doesNotMatch((await files.searchText(ctxFor(root), { pattern: 'Tenancy' })).text, /\.env\.docx/);
  });
});

describe('the document reader', () => {
  it('runs locked down: a sandboxed window in the app, Node’s permission model elsewhere', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../src/agent/files/documents.js'), 'utf8');
    for (const flag of ['--permission', '--disallow-code-generation-from-strings', '--allow-fs-read=${appRoot}']) assert.ok(source.includes(flag), flag);
    assert.equal(/--allow-(fs-write|child-process|worker|addons|wasi)/.test(source), false);
    // In the app: a sandboxed window with no Node, in a session that loads only Quo's own files and refuses permissions.
    const window = fs.readFileSync(path.join(__dirname, '../../src/agent/files/reader/window.js'), 'utf8');
    for (const setting of ['sandbox: true', 'contextIsolation: true', 'nodeIntegration: false', 'setPermissionRequestHandler', 'onBeforeRequest', "action: 'deny'", 'event.sender === this.window.webContents']) assert.ok(window.includes(setting), setting);
    assert.match(fs.readFileSync(path.join(__dirname, '../../src/agent/files/reader/reader.html'), 'utf8'), /default-src 'none'; script-src 'self'/);
  });

  it('can’t write a file, even if a document took it over', async () => {
    // The worker's own limits, run with the same flags on a script that tries.
    const { execFileSync } = require('node:child_process');
    const dir = path.join(__dirname, '../..');
    const target = path.join(temp(), 'written.txt');
    assert.throws(() => execFileSync(process.execPath, ['--permission', `--allow-fs-read=${dir}`, '-e', `require('node:fs').writeFileSync(${JSON.stringify(target)}, 'x')`], { stdio: 'pipe' }));
    assert.throws(() => execFileSync(process.execPath, ['--permission', `--allow-fs-read=${dir}`, '-e', `require('node:child_process').execSync('echo hi')`], { stdio: 'pipe' }));
    assert.equal(fs.existsSync(target), false);
  });

  it('gives up on a document that keeps it busy, and starts afresh for the next', async () => {
    const hang = path.join(__dirname, 'hang-worker.mjs');
    fs.writeFileSync(hang, 'setInterval(() => {}, 1000); process.stdin.resume();\n');
    try {
      const slow = new DocumentReader({ worker: hang, timeoutMs: 300 });
      await assert.rejects(slow.extract('pdf', Buffer.from('x')), error => error.code === 'document_slow');
      assert.equal(slow.running, false);
      slow.stop();
    } finally {
      fs.rmSync(hang, { force: true });
    }
  });
});
