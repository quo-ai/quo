'use strict';

const { WebError } = require('./errors');
const { entities, plain } = require('./extract');

/**
 * Search services behind one function. Each takes a query and returns [{ title, url, snippet }]. Four need an address
 * or key from the user (Brave, Tavily, Exa, SearXNG), and DuckDuckGo needs nothing, which is why it is the last resort:
 * it reads the results page, so it can stop working or ask for a CAPTCHA.
 */

const BACKENDS = {
  brave: { name: 'Brave Search', needsKey: true, keyUrl: 'https://api.search.brave.com/app/keys' },
  tavily: { name: 'Tavily', needsKey: true, keyUrl: 'https://app.tavily.com/home' },
  exa: { name: 'Exa', needsKey: true, keyUrl: 'https://dashboard.exa.ai/api-keys' },
  searxng: { name: 'SearXNG', needsUrl: true },
  duckduckgo: { name: 'DuckDuckGo' },
};
/** What "automatic" tries, in order: a service with a key, then the user's own SearXNG, then DuckDuckGo. */
const AUTO_ORDER = ['brave', 'tavily', 'exa', 'searxng', 'duckduckgo'];

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const web = url => /^https?:\/\//i.test(url);

async function ask(fetchFn, name, url, init = {}) {
  let response;
  try {
    response = await fetchFn(url, { ...init, signal: AbortSignal.timeout(15_000), redirect: 'error' });
  } catch {
    throw new WebError('unreachable', `Couldn’t reach ${name}. Check the connection.`);
  }
  if (response.status === 401 || response.status === 403) throw new WebError('auth', `${name} didn’t accept the key or the request.`);
  if (response.status === 402 || response.status === 429) throw new WebError('limit', `${name} says the searches are used up, or Quo is searching too fast.`);
  if (!response.ok) throw new WebError('failed', `${name} answered ${response.status}.`);
  return (await response.text()).slice(0, 1_500_000);
}

const json = (text, name) => {
  try {
    return JSON.parse(text);
  } catch {
    throw new WebError('failed', `${name} gave an answer Quo couldn’t read.`);
  }
};
const shape = list => list.filter(item => item.title && web(item.url)).map(item => ({ title: clip(plain(item.title), 140), url: item.url, snippet: clip(plain(item.snippet ?? ''), 300) }));
const post = (key, header, body) => ({ method: 'POST', headers: { 'content-type': 'application/json', [header]: key }, body: JSON.stringify(body) });

const run = {
  async brave({ query, count, key, fetchFn }) {
    const data = json(await ask(fetchFn, 'Brave Search', `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`, { headers: { accept: 'application/json', 'x-subscription-token': key } }), 'Brave Search');
    return shape((data.web?.results ?? []).map(r => ({ title: r.title, url: r.url, snippet: r.description })));
  },
  async tavily({ query, count, key, fetchFn }) {
    const data = json(await ask(fetchFn, 'Tavily', 'https://api.tavily.com/search', post(`Bearer ${key}`, 'authorization', { query, max_results: count, search_depth: 'basic' })), 'Tavily');
    return shape((data.results ?? []).map(r => ({ title: r.title, url: r.url, snippet: r.content })));
  },
  async exa({ query, count, key, fetchFn }) {
    const data = json(await ask(fetchFn, 'Exa', 'https://api.exa.ai/search', post(key, 'x-api-key', { query, numResults: count, contents: { text: { maxCharacters: 400 } } })), 'Exa');
    return shape((data.results ?? []).map(r => ({ title: r.title, url: r.url, snippet: r.text })));
  },
  async searxng({ query, count, url, fetchFn }) {
    let text;
    try {
      text = await ask(fetchFn, 'SearXNG', `${url}/search?q=${encodeURIComponent(query)}&format=json`, { headers: { accept: 'application/json' } });
    } catch (error) {
      if (error.code === 'auth') throw new WebError('auth', 'That SearXNG doesn’t allow JSON results. Turn on the json format in its settings (search → formats).');
      throw error;
    }
    return shape((json(text, 'SearXNG').results ?? []).slice(0, count).map(r => ({ title: r.title, url: r.url, snippet: r.content })));
  },
  async duckduckgo({ query, count, fetchFn }) {
    const html = await ask(fetchFn, 'DuckDuckGo', `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; Quo/1.3; +https://quoai.vercel.app)', accept: 'text/html' } });
    return parseDuckDuckGo(html, count);
  },
};

/** The results on DuckDuckGo's plain page. Their links are sometimes wrapped in a redirect, which is undone here. */
function parseDuckDuckGo(html, count) {
  const found = [];
  const starts = [...html.matchAll(/<a\b[^>]*class="[^"]*\bresult__a\b[^"]*"[^>]*>/g)];
  starts.forEach((start, index) => {
    const end = starts[index + 1]?.index ?? html.length;
    const block = html.slice(start.index, end);
    let url = entities(/href="([^"]*)"/.exec(start[0])?.[1] ?? '');
    const wrapped = /[?&]uddg=([^&]+)/.exec(url);
    if (wrapped) url = decodeURIComponent(wrapped[1]);
    if (url.startsWith('//')) url = `https:${url}`;
    if (/^https?:\/\/duckduckgo\.com\/y\.js/.test(url)) return; // an advert
    const title = /<a\b[^>]*result__a[^>]*>([\s\S]*?)<\/a>/.exec(block)?.[1] ?? '';
    const snippet = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/.exec(block)?.[1] ?? '';
    found.push({ title, url, snippet });
  });
  if (!found.length && /anomaly|captcha|unusual traffic/i.test(html)) {
    throw new WebError('blocked', 'DuckDuckGo wants a CAPTCHA right now. Try again later, or add a search key (Brave, Tavily or Exa) in Models & storage → Web.');
  }
  return shape(found.slice(0, count));
}

module.exports = { BACKENDS, AUTO_ORDER, search: (backend, options) => run[backend](options), parseDuckDuckGo };
