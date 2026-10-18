import { AVAILABLE_MODELS, getModelById, DEFAULT_MODEL_ID, getDefaultModel } from '../models';

describe('model catalog integrity', () => {
  it('has unique ids and filenames', () => {
    const ids = AVAILABLE_MODELS.map(m => m.id);
    const filenames = AVAILABLE_MODELS.map(m => m.modelFilename);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(filenames).size).toBe(filenames.length);
  });

  it('every model has a prompt, stop sequences, and valid HTTPS urls', () => {
    for (const model of AVAILABLE_MODELS) {
      expect(model.systemPrompt.length).toBeGreaterThan(20);
      expect(model.stopSequences.length).toBeGreaterThan(0);
      expect(model.modelUrl).toMatch(/^https:\/\//);
      expect(model.modelFilename).toMatch(/\.gguf$/);
      expect(model.sizeBytes).toBeGreaterThan(100_000_000);
      if (model.hasVision) {
        expect(model.mmprojUrl).toMatch(/^https:\/\//);
        expect(model.mmprojFilename).toMatch(/\.gguf$/);
      }
    }
  });

  it('draft model references resolve to smaller same-catalog models', () => {
    for (const model of AVAILABLE_MODELS) {
      if (!model.draftModelId) continue;
      const draft = getModelById(model.draftModelId);
      expect(draft).toBeDefined();
      expect(draft!.id).not.toBe(model.id);
      expect(draft!.sizeBytes).toBeLessThan(model.sizeBytes);
    }
  });

  it('default model exists and stays the starter', () => {
    expect(getDefaultModel().id).toBe(DEFAULT_MODEL_ID);
    expect(getModelById(DEFAULT_MODEL_ID)).toBeDefined();
  });
});
