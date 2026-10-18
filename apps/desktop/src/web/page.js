'use strict';

const http = require('node:http');
const https = require('node:https');
const zlib = require('node:zlib');
const { WebError } = require('./errors');
const { guardedLookup, parseWebUrl } = require('./guard');

/**
 * Fetches one web page for the model: GET only, no cookies or login, a size and time limit, redirects followed
 * but each one checked like the first address, and the connection made only to a public address (guard.js).
 * It says plainly what it is (Quo), rather than pretending to be a browser.
 */

const LIMITS = { maxBytes: 2 * 1024 * 1024, timeoutMs: 15_000, maxRedirects: 5 };
const READABLE = /^(text\/|application\/(json|xml|xhtml\+xml|ld\+json|rss\+xml|atom\+xml)|.*\+(json|xml))/i;

function decoder(stream, encoding) {
  const kind = String(encoding ?? '').toLowerCase();
  if (kind.includes('br')) return stream.pipe(zlib.createBrotliDecompress());
  if (kind.includes('gzip')) return stream.pipe(zlib.createGunzip());
  if (kind.includes('deflate')) return stream.pipe(zlib.createInflate());
  return stream;
}

function open(url, { allowPrivate, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? https : http).request(url, {
      method: 'GET',
      lookup: allowPrivate ? undefined : guardedLookup,
      headers: { 'user-agent': 'Quo/1.3 (+https://quoai.vercel.app)', accept: 'text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.1', 'accept-encoding': 'gzip, deflate, br', 'accept-language': 'en' },
    }, resolve);
    const timer = setTimeout(() => request.destroy(new WebError('timeout', 'The site took too long to answer.')), timeoutMs);
    request.on('close', () => clearTimeout(timer));
    request.on('error', error => reject(error instanceof WebError ? error : new WebError('unreachable', `Couldn’t reach ${url.hostname}.`)));
    request.end();
  });
}

async function read(response, maxBytes) {
  const chunks = [];
  let size = 0;
  let truncated = false;
  const body = decoder(response, response.headers['content-encoding']);
  try {
    for await (const chunk of body) {
      size += chunk.length;
      if (size > maxBytes) {
        chunks.push(chunk.subarray(0, chunk.length - (size - maxBytes)));
        truncated = true;
        break;
      }
      chunks.push(chunk);
    }
  } catch {
    if (!chunks.length) throw new WebError('unreachable', 'The site’s answer couldn’t be read.');
    truncated = true;
  } finally {
    response.destroy();
  }
  return { buffer: Buffer.concat(chunks), truncated };
}

function decode(buffer, contentType) {
  let label = /charset=["']?([\w-]+)/i.exec(contentType)?.[1] ?? /<meta[^>]+charset=["']?([\w-]+)/i.exec(buffer.subarray(0, 2048).toString('latin1'))?.[1] ?? 'utf-8';
  try {
    return new TextDecoder(label).decode(buffer);
  } catch {
    label = 'utf-8';
    return new TextDecoder(label).decode(buffer);
  }
}

/** Returns { url, status, contentType, text, truncated }, or throws a WebError that says why not. */
async function fetchPage(input, options = {}) {
  const limits = { ...LIMITS, ...options.limits };
  const allowPrivate = options.allowPrivate === true;
  let url = parseWebUrl(input, { allowPrivate });
  for (let hop = 0; ; hop++) {
    const response = await open(url, { allowPrivate, timeoutMs: limits.timeoutMs });
    const status = response.statusCode ?? 0;
    if (status >= 300 && status < 400 && response.headers.location) {
      response.destroy();
      if (hop >= limits.maxRedirects) throw new WebError('redirects', 'The site sent Quo round in circles.');
      url = parseWebUrl(new URL(response.headers.location, url).href, { allowPrivate });
      continue;
    }
    const contentType = String(response.headers['content-type'] ?? '');
    if (status >= 400) {
      response.destroy();
      throw new WebError('http', status === 404 ? 'There’s no page at that address (404).' : `The site answered ${status}${status === 403 || status === 401 ? ', so it doesn’t let Quo read this page' : ''}.`);
    }
    if (contentType && !READABLE.test(contentType)) {
      response.destroy();
      throw new WebError('unsupported', `That is ${/pdf/i.test(contentType) ? 'a PDF' : `a ${contentType.split(';')[0]} file`}, not a page Quo can read as text.`);
    }
    const { buffer, truncated } = await read(response, limits.maxBytes);
    return { url: url.href, status, contentType, text: decode(buffer, contentType), truncated };
  }
}

module.exports = { fetchPage, LIMITS };
