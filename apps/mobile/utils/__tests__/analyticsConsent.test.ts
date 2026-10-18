import { decideConsentRegion, isConsentCountry } from '../analyticsConsent';

describe('isConsentCountry', () => {
  it('recognises EU and EEA countries in both ISO formats', () => {
    for (const code of ['DE', 'DEU', 'FR', 'fra', 'IE', 'NO', 'NOR', 'IS', 'LI', 'EL', 'GRC', ' es ']) {
      expect(isConsentCountry(code)).toBe(true);
    }
  });

  it('includes EU outermost regions that have their own codes', () => {
    expect(isConsentCountry('RE')).toBe(true);
    expect(isConsentCountry('GLP')).toBe(true);
  });

  it('excludes non-EEA countries and empty values', () => {
    for (const code of ['US', 'USA', 'GB', 'GBR', 'CH', 'IN', 'IND', 'BR', 'ID', '', null, undefined]) {
      expect(isConsentCountry(code)).toBe(false);
    }
  });
});

describe('decideConsentRegion', () => {
  it('asks when the store country is in a consent region', () => {
    expect(decideConsentRegion('DEU', 'US')).toEqual({ requiresConsent: true, definitive: true });
  });

  it('asks when only the device region is in a consent region', () => {
    expect(decideConsentRegion('US', 'FR')).toEqual({ requiresConsent: true, definitive: true });
    expect(decideConsentRegion(null, 'FR')).toEqual({ requiresConsent: true, definitive: true });
  });

  it('does not ask outside consent regions, and trusts a known store country', () => {
    expect(decideConsentRegion('IN', 'IN')).toEqual({ requiresConsent: false, definitive: true });
  });

  it('is not definitive when the store country is unknown and the device says no', () => {
    expect(decideConsentRegion(null, 'US')).toEqual({ requiresConsent: false, definitive: false });
    expect(decideConsentRegion(null, null)).toEqual({ requiresConsent: false, definitive: false });
  });
});
