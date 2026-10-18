import type { CloudCatalog, CloudModel } from './catalog';

/** Credits a month Quo Pro includes (server/billing.ts). */
export const PRO_MONTHLY_CREDITS = 1000;

export interface ModelGroups {
  /** The default model, free within the daily allowance. */
  free: CloudModel[];
  /** The flagship models: locked until the person has credits. */
  frontier: CloudModel[];
  /** The other paid models: quick and cheap. */
  everyday: CloudModel[];
}

/** The catalog in the groups people see it in, each in the catalog's own order. */
export function groupModels(catalog: CloudCatalog | null): ModelGroups {
  const models = catalog?.models ?? [];
  return {
    free: models.filter(model => model.free),
    frontier: models.filter(model => !model.free && model.tier === 'frontier'),
    everyday: models.filter(model => !model.free && model.tier !== 'frontier'),
  };
}
