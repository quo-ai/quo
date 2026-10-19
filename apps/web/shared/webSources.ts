/**
 * The searches a provider ran for a reply and the pages it drew on, read from what the provider streams back, so the
 * chat can show "Searched the web for …" and a row of sources under the reply. Everything here comes from a third party
 * and is treated as untrusted: only http(s) addresses, no duplicates, short titles, a handful at most. The chat draws
 * titles as text, never as HTML.
 *
 *  - OpenRouter (Quo's cloud models, and the user's own OpenRouter key): `url_citation` annotations, and a
 *    `reasoning.server_tool_call` record among the reasoning details for each search its server tool ran.
 *  - Anthropic (the user's own key): `server_tool_use` blocks for searches, `web_search_tool_result` blocks for results,
 *    and `web_search_result_location` citations on the text.
 */

export interface WebSource {
  url: string;
  title?: string;
}

export const MAX_SOURCES = 10;
const MAX_TITLE = 160;
const MAX_QUERY = 200;

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Adds a page to the list if it is a real web address not already there. */
export function addSource(list: WebSource[], url: unknown, title?: unknown): void {
  if (list.length >= MAX_SOURCES || typeof url !== 'string' || url.length > 2048) return;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return;
  if (parsed.username || parsed.password) return;
  const href = parsed.href;
  if (list.some(source => source.url === href)) return;
  const name = text(title).replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
  list.push(name ? { url: href, title: name } : { url: href });
}

/** OpenAI-style annotations: `{type: 'url_citation', url_citation: {url, title}}` (or the fields at the top level). */
export function addAnnotations(list: WebSource[], annotations: unknown): void {
  if (!Array.isArray(annotations)) return;
  for (const annotation of annotations as Record<string, unknown>[]) {
    if (!annotation || annotation.type !== 'url_citation') continue;
    const citation = (annotation.url_citation ?? annotation) as Record<string, unknown>;
    addSource(list, citation.url, citation.title);
  }
}

/** The search words in a tool's arguments (a JSON string or an object with `query`), cleaned for showing. */
export function queryOf(args: unknown): string {
  let value = args;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return '';
    }
  }
  const query = value && typeof value === 'object' ? (value as Record<string, unknown>).query : undefined;
  return text(query).replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY);
}

/** OpenRouter's records of the searches its server tool ran, from a delta's `reasoning_details`: an id and the search words. */
export function serverSearches(details: unknown): { id: string; query: string }[] {
  if (!Array.isArray(details)) return [];
  const found: { id: string; query: string }[] = [];
  for (const detail of details as Record<string, unknown>[]) {
    if (!detail || detail.type !== 'reasoning.server_tool_call' || !/web_search/.test(text(detail.tool_name))) continue;
    found.push({ id: text(detail.tool_call_id) || text(detail.id), query: queryOf(detail.arguments) });
  }
  return found;
}

/**
 * The sources for a reply that used the desktop's own search tools: the pages the model read, then search results the
 * reply links to, and when it read none and linked none, the top few results it answered from.
 */
export function pickSources(read: WebSource[], found: WebSource[], reply: string): WebSource[] {
  const list: WebSource[] = [];
  for (const page of read) addSource(list, page.url, page.title);
  for (const result of found) if (reply.includes(result.url)) addSource(list, result.url, result.title);
  if (!list.length) for (const result of found.slice(0, 3)) addSource(list, result.url, result.title);
  return list;
}
