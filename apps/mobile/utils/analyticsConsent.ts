import { getLocales } from 'expo-localization';

/**
 * Where analytics needs opt-in consent before any collection (EU ePrivacy
 * Directive art. 5(3) + GDPR): EU member states, their outermost regions that
 * have their own ISO codes, and the EEA (Iceland, Liechtenstein, Norway).
 * Elsewhere Quo relies on notice + the Settings opt-out. To require consent
 * in another market (e.g. India under the DPDP Act), add its codes here.
 *
 * Both ISO 3166-1 alpha-2 (Google Play, device region) and alpha-3 (Apple
 * storefront) codes are listed. 'EL' is the EU's own code for Greece.
 */
const CONSENT_COUNTRIES = new Set([
  // EU member states
  'AT', 'AUT', 'BE', 'BEL', 'BG', 'BGR', 'HR', 'HRV', 'CY', 'CYP', 'CZ', 'CZE',
  'DK', 'DNK', 'EE', 'EST', 'FI', 'FIN', 'FR', 'FRA', 'DE', 'DEU', 'GR', 'EL',
  'GRC', 'HU', 'HUN', 'IE', 'IRL', 'IT', 'ITA', 'LV', 'LVA', 'LT', 'LTU', 'LU',
  'LUX', 'MT', 'MLT', 'NL', 'NLD', 'PL', 'POL', 'PT', 'PRT', 'RO', 'ROU', 'SK',
  'SVK', 'SI', 'SVN', 'ES', 'ESP', 'SE', 'SWE',
  // EU regions with their own ISO codes
  'AX', 'ALA', 'GP', 'GLP', 'GF', 'GUF', 'MQ', 'MTQ', 'RE', 'REU', 'YT', 'MYT',
  'MF', 'MAF',
  // EEA
  'IS', 'ISL', 'LI', 'LIE', 'NO', 'NOR',
]);

export function isConsentCountry(code: string | null | undefined): boolean {
  return Boolean(code) && CONSENT_COUNTRIES.has(code!.trim().toUpperCase());
}

export interface ConsentRegionCheck {
  /** Analytics must stay off until the user opts in. */
  requiresConsent: boolean;
  /** Safe to cache: the store country was known, or a signal already said
   *  consent is needed. Otherwise re-check next launch. */
  definitive: boolean;
}

/**
 * Store country is the strongest signal (where the user's account lives);
 * the device region is the offline fallback. If either is in a consent
 * region, ask: when signals disagree, asking is the lawful direction.
 */
export function decideConsentRegion(
  storeCountry: string | null | undefined,
  deviceRegion: string | null | undefined,
): ConsentRegionCheck {
  const requiresConsent = isConsentCountry(storeCountry) || isConsentCountry(deviceRegion);
  return { requiresConsent, definitive: Boolean(storeCountry) || requiresConsent };
}

/** Region from the device's language & region settings; works offline. */
export function getDeviceRegion(): string | null {
  try {
    return getLocales()[0]?.regionCode ?? null;
  } catch {
    return null;
  }
}
