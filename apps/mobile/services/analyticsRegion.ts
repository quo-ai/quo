import { decideConsentRegion, getDeviceRegion, type ConsentRegionCheck } from '@/utils/analyticsConsent';
import { getStoreCountry } from './iap';

/**
 * Full region check for analytics consent: store account country (bounded
 * by a timeout) plus the device region. Lives outside analyticsService
 * because iap imports analyticsService; the root layout injects it via
 * analyticsService.setRegionResolver.
 */
export async function resolveAnalyticsRegion(): Promise<ConsentRegionCheck> {
  const storeCountry = await getStoreCountry();
  return decideConsentRegion(storeCountry, getDeviceRegion());
}
