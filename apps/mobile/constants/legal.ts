import { Platform } from 'react-native';

// Hosted from web/ (Vercel project "quo"). Apple (paywall + App Store Connect
// metadata) and Google (Play Console data-safety declaration) both link here.
const SITE_URL = 'https://quoai.vercel.app';

export const PRIVACY_POLICY_URL = `${SITE_URL}/privacy/`;

// Apple's standard EULA covers terms on iOS; Android uses the site's terms.
export const TERMS_URL = Platform.OS === 'ios'
  ? 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/'
  : `${SITE_URL}/terms/`;

export const CONTACT_EMAIL = 'astralabsltd@gmail.com';
