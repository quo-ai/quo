import { ApiError } from '../cloud/api';
import type { ProviderInfo } from './registry';

/** A provider said no, or couldn't be reached. Extends ApiError so the chat's failure card handles it like any other. */
export class ProviderError extends ApiError {
  constructor(status: number, code: string, message: string, readonly provider: string) {
    super(status, code, message);
  }
}

const KEY_SHAPES = /\b(?:sk-[A-Za-z0-9_-]{12,}|AIza[0-9A-Za-z_-]{20,}|xai-[A-Za-z0-9]{20,}|gsk_[A-Za-z0-9]{20,}|pplx-[A-Za-z0-9]{20,})\b/g;

/** What a provider said was wrong, without anything that looks like a key, and short. */
export function detailOf(text: string): string {
  let detail = text.trim();
  try {
    const json = JSON.parse(text) as { error?: { message?: unknown } | string; message?: unknown };
    const found = typeof json.error === 'string' ? json.error : json.error?.message ?? json.message;
    if (typeof found === 'string') detail = found;
  } catch {
    // Not JSON: use the text as it is.
  }
  detail = detail.replace(KEY_SHAPES, '[key removed]').replace(/\s+/g, ' ').trim();
  return detail.length > 220 ? `${detail.slice(0, 220)}…` : detail;
}

/** The error to show for a failed request: what happened, in words, with what to do about it. */
export function errorFor(provider: ProviderInfo, status: number, text: string): ProviderError {
  const detail = detailOf(text);
  const { name } = provider;
  const credit = /quota|billing|credit|balance|insufficient|payment/i.test(detail);
  const error = (code: string, message: string) => new ProviderError(status, code, message, provider.id);
  if (status === 401 || status === 403) return error('provider_auth', `${name} didn’t accept your key.${detail ? ` It said: ${detail}` : ''}`);
  if (status === 402 || (status === 429 && credit)) return error('provider_credit', `Your ${name} account is out of credit or over its limit.${detail ? ` It said: ${detail}` : ''}`);
  if (status === 429) return error('provider_limit', `${name} says you’re going too fast. Wait a moment and try again.`);
  if (status === 404) return error('provider_model', `${name} doesn’t have that model on your account.${detail ? ` It said: ${detail}` : ''}`);
  if (status >= 500) return error('provider_server', `${name} had a problem on its side. Try again in a moment.`);
  return error('provider_failed', `${name} refused the request.${detail ? ` It said: ${detail}` : ''}`);
}
