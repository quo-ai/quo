'use strict';

/**
 * The readable part of a web page, as plain text: headings, paragraphs, lists, code and tables, without scripts,
 * menus, forms or footers; plus the page's links, so a follow-up page can be opened. Small and forgiving, not a
 * full HTML parser: it's for reading, and a page it can't make sense of just comes out short.
 */

const DROP = ['script', 'style', 'noscript', 'template', 'svg', 'iframe', 'canvas', 'form', 'nav', 'footer', 'aside', 'button', 'select', 'dialog'];
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', copy: '©', reg: '®', trade: '™', laquo: '«', raquo: '»', bull: '•', middot: '·' };

function entities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name) => {
    if (name[0] === '#') {
      const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match;
    }
    return NAMED[name.toLowerCase()] ?? match;
  });
}

const plain = html => entities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/** The longest <tag>…</tag> in the html, if it holds real content. */
function largest(html, tag) {
  let best = '';
  for (const match of html.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi'))) if (match[1].length > best.length) best = match[1];
  return best.length > 500 ? best : null;
}

function extractReadable(html, baseUrl) {
  const title = plain(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '');
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, '');
  let body = largest(withoutComments, 'article') ?? largest(withoutComments, 'main') ?? /<body[^>]*>([\s\S]*)<\/body>/i.exec(withoutComments)?.[1] ?? withoutComments;
  for (const tag of DROP) body = body.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi'), ' ');

  const links = [];
  const seen = new Set();
  body.replace(/<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi, (_m, double, single, inner) => {
    try {
      const url = new URL(entities(double ?? single ?? ''), baseUrl);
      url.hash = '';
      const text = plain(inner);
      if ((url.protocol === 'http:' || url.protocol === 'https:') && text && !seen.has(url.href) && links.length < 25) {
        seen.add(url.href);
        links.push({ text: text.slice(0, 100), url: url.href });
      }
    } catch {
      // Not an address.
    }
    return '';
  });

  const structured = body
    .replace(/<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, tag, inner) => `\n\n${'#'.repeat(Number(tag[1]))} ${plain(inner)}\n\n`)
    .replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_m, inner) => `\n\n\`\`\`\n${entities(inner.replace(/<[^>]+>/g, ''))}\n\`\`\`\n\n`)
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<(br|hr)\b[^>]*>/gi, '\n')
    .replace(/<(p|div|section|tr|table|ul|ol|blockquote)\b[^>]*>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<\/(p|div|section|tr|table|ul|ol|blockquote|figure|figcaption|dd|dt|dl|h\d)>/gi, '\n');
  // Whitespace is tidied everywhere except inside code blocks, where the indentation is the point.
  const text = entities(structured.replace(/<[^>]+>/g, ''))
    .split(/(```[\s\S]*?```)/)
    .map((part, index) => (index % 2 ? part : part.split('\n').map(line => line.replace(/[ \t]+/g, ' ').trim()).join('\n')))
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { title, text, links };
}

/** A page that is mostly scripts: its text only appears once they run. */
const needsRendering = (html, text) => text.length < 400 && /<script\b/i.test(html);

module.exports = { extractReadable, needsRendering, plain, entities };
