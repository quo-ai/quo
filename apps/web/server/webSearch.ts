/**
 * Web search for cloud chat is OpenRouter's web plugin: one search per message, run by OpenRouter, with the results
 * added to what the model reads. The engine is fixed (Exa) so what a search costs is known: a fee per search, and the
 * results as extra input tokens (about 3,000 characters each). Free replies have a small daily allowance of their own.
 */

const RESULTS = 5;

export const webPlugin = () => ({ id: 'web', engine: 'exa', max_results: RESULTS });

/** Exa's price per search through OpenRouter, in USD. */
export const SEARCH_FEE_USD = 0.007;
export const SEARCH_INPUT_TOKENS = RESULTS * 1200;
