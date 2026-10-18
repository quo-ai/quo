import type { CloudCatalog, CloudModel } from './catalog';

/** Credits a month Quo Pro includes (server/billing.ts). */
export const PRO_MONTHLY_CREDITS = 1000;

/** The frontier models: the ones Quo Pro is for. */
export function frontierModels(catalog: CloudCatalog | null): CloudModel[] {
  return catalog?.models.filter(model => !model.free && model.tier === 'frontier') ?? [];
}

/** The paid models that aren't frontier ones: fast and cheap. */
export function everydayModels(catalog: CloudCatalog | null): CloudModel[] {
  return catalog?.models.filter(model => !model.free && model.tier !== 'frontier') ?? [];
}

/** How many typical messages a month's credits last on a model, rounded so it reads as an estimate. */
export function messagesPerMonth(creditsPerMessage: number, credits = PRO_MONTHLY_CREDITS): number {
  if (!(creditsPerMessage > 0)) return 0;
  const messages = credits / creditsPerMessage;
  const step = messages >= 1000 ? 100 : messages >= 100 ? 5 : 1;
  return Math.max(1, Math.round(messages / step) * step);
}

export interface Example {
  model: CloudModel;
  messages: number;
}

/**
 * What a month of Quo Pro buys, on three models that span the range: the dearest
 * frontier model, a middling one, and the cheapest paid model. Chosen by cost,
 * not by name, so it stays right as the catalog changes.
 */
export function proExamples(catalog: CloudCatalog | null): Example[] {
  const frontier = [...frontierModels(catalog)].sort((a, b) => b.creditsPerMessage - a.creditsPerMessage);
  const cheapest = [...(catalog?.models.filter(model => !model.free) ?? [])].sort((a, b) => a.creditsPerMessage - b.creditsPerMessage)[0];
  const picks = [frontier[0], frontier[Math.floor(frontier.length / 2)], cheapest].filter((model): model is CloudModel => Boolean(model));
  const unique = picks.filter((model, index) => picks.findIndex(other => other.id === model.id) === index);
  return unique.map(model => ({ model, messages: messagesPerMonth(model.creditsPerMessage) }));
}
