import { WEB_APP_URL } from './platform';

/**
 * A copy of Quo Web built to run without Quo's server (`npm run build:standalone`), for a static host such as a Hugging
 * Face Space. Offline models and the person's own API keys work as usual (keys go straight from the browser to the
 * provider). Everything that needs Quo's server (cloud models, sign-in, Quo Sync, purchases, pictures) answers as a
 * service that isn't set up here, with the address of the full app; it stays visible, as services that aren't set up
 * always do (CLAUDE.md). Every call to Quo's server goes through `apiFetch` (cloud/api.ts), which checks this.
 */
export const STANDALONE = import.meta.env.MODE === 'standalone';

export const STANDALONE_MESSAGE = `This copy of Quo runs offline models only. Cloud models, sign-in and Quo Sync are in the full app at ${WEB_APP_URL.replace(/^https:\/\//, '')}.`;
