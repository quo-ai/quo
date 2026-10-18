/** What plans cost, as shown in the app (the same figures as server/billing.ts). */
export const PRICES = {
  proMonthly: '$12 / month',
  proYearly: '$99 / year',
  /** The smallest credit pack (1,000 credits). */
  smallestPack: '$12',
} as const;

/** What a new account starts with (server/credits.ts: TRIAL_CREDITS, TRIAL_DAYS). */
export const TRIAL = { credits: 25, days: 90 } as const;
