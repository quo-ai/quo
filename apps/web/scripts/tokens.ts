// Writes src/styles/tokens.css from src/styles/appearances.ts, and the website's copy (website/assets/tokens.css), so the
// site and the apps share one set of colours. Run after changing a colour: `npm run tokens`.
// (src/__tests__/appearances.test.ts fails if either file is out of date, or if any pair misses its contrast.)
import { writeFileSync } from 'node:fs';
import { tokensCss } from '../src/styles/appearances.ts';

writeFileSync(new URL('../src/styles/tokens.css', import.meta.url), tokensCss());
writeFileSync(new URL('../../../website/assets/tokens.css', import.meta.url), tokensCss());
console.log('src/styles/tokens.css and website/assets/tokens.css written');
