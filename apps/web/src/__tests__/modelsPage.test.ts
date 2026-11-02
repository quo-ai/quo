// @vitest-environment node
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { modelsData } from '../../scripts/models-data';

it('the website’s model page says what the apps really offer (after a catalog change, run npm run models)', () => {
  const fresh = modelsData();
  // The phone catalog is read from its source text: if its layout changes, this says so instead of listing nothing.
  expect(fresh.phone.length).toBeGreaterThanOrEqual(8);
  expect(fresh.phone.every(model => model.name && model.description && model.downloadGB > 0)).toBe(true);
  expect(fresh.phone.filter(model => model.free)).toHaveLength(3);
  expect(fresh.desktop.every(model => model.memoryGB && model.downloadGB > 0)).toBe(true);
  const written = JSON.parse(readFileSync(new URL('../../../../website/scripts/models.json', import.meta.url), 'utf8'));
  expect(written).toEqual(fresh);
});
