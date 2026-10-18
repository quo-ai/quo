import { getModelExpectationHint } from '../modelExpectation';
import { getModelById } from '@/constants/models';

jest.mock('expo-device', () => ({ totalMemory: null }));

const GB = 1024 ** 3;
const hint = (id: string, ramGb: number) => getModelExpectationHint(getModelById(id)!.sizeBytes, ramGb * GB);

describe('device-aware model hints', () => {
  it('flags light models as fast but error-prone everywhere', () => {
    expect(hint('qwen35-0.8b', 12)).toMatch(/^Fastest/);
  });

  it('warns about speed relative to the phone, not absolute size', () => {
    expect(hint('qwen35-2b', 12)).toBeNull();          // flagship: fine
    expect(hint('qwen35-2b', 4)).toMatch(/slow on this phone/); // budget phone
    expect(hint('qwen35-4b', 12)).toMatch(/slow on this phone/);
    expect(hint('ministral-3b-instruct', 16)).toBeNull();
  });

  it('defers to the memory warning when a model barely fits', () => {
    expect(hint('gemma4-e2b', 4)).toBeNull();
  });
});
