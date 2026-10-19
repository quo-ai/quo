/**
 * Web search for cloud chat is OpenRouter's web search server tool: the model is offered a search and decides itself
 * whether a message needs one, and how many (up to `max_uses`), the way Claude.ai and ChatGPT do. OpenRouter runs the
 * searches and gives the model the results. (Its older web plugin searched once for every message, which is why the app
 * had a Web switch; the plugin is deprecated.) The engine is fixed (Exa) so what a search costs is known: a fee per
 * search, and the results as extra input tokens (about 3,000 characters each). The free model gets one search a reply,
 * from a small daily allowance of its own; replies on credits get a few, paid with them.
 */

const RESULTS = 5;

/** Searches one reply may make. */
export const FREE_SEARCHES_PER_REPLY = 1;
export const PAID_SEARCHES_PER_REPLY = 3;

export const webTool = (maxUses: number) => ({ type: 'openrouter:web_search', parameters: { engine: 'exa', max_results: RESULTS, max_uses: maxUses } });

/** Exa's price per search through OpenRouter, in USD. */
export const SEARCH_FEE_USD = 0.007;
export const SEARCH_INPUT_TOKENS = RESULTS * 1200;
