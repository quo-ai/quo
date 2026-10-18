import { getInfoAsync, readAsStringAsync } from 'expo-file-system/legacy';
import { isModelFileValid, getModelMinValidBytes } from '../llm/paths';

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///test-documents/',
  getInfoAsync: jest.fn(),
  readAsStringAsync: jest.fn(),
}));

const mockedGetInfo = getInfoAsync as jest.Mock;
const mockedRead = readAsStringAsync as jest.Mock;

const catalogModel = { modelFilename: 'model.gguf', sizeBytes: 1_000_000_000 };
const customModel = { modelFilename: 'custom.gguf', sizeBytes: 0 };

beforeEach(() => {
  jest.clearAllMocks();
  mockedRead.mockResolvedValue('R0dVRg=='); // real GGUF files start with "GGUF"
});

describe('isModelFileValid', () => {
  it('accepts a catalog model at >= 95% of its size', async () => {
    mockedGetInfo.mockResolvedValue({ exists: true, size: 950_000_000 });
    expect(await isModelFileValid(catalogModel)).toBe(true);
    expect(mockedGetInfo).toHaveBeenCalledWith('file:///test-documents/models/model.gguf');
  });

  it('rejects a truncated catalog model', async () => {
    mockedGetInfo.mockResolvedValue({ exists: true, size: 949_999_999 });
    expect(await isModelFileValid(catalogModel)).toBe(false);
  });

  it('rejects a captive-portal HTML body', async () => {
    mockedGetInfo.mockResolvedValue({ exists: true, size: 5_000 });
    expect(await isModelFileValid(catalogModel)).toBe(false);
  });

  it('rejects a right-sized file that is not a GGUF', async () => {
    mockedGetInfo.mockResolvedValue({ exists: true, size: 1_000_000_000 });
    mockedRead.mockResolvedValue('PCFET0M='); // "<!DOC"
    expect(await isModelFileValid(catalogModel)).toBe(false);
  });

  it('rejects a missing file', async () => {
    mockedGetInfo.mockResolvedValue({ exists: false });
    expect(await isModelFileValid(catalogModel)).toBe(false);
  });

  it('checks an explicit path (e.g. the download temp file)', async () => {
    mockedGetInfo.mockResolvedValue({ exists: true, size: 1_000_000_000 });
    expect(await isModelFileValid(catalogModel, 'file:///x/model.gguf.tmp')).toBe(true);
    expect(mockedGetInfo).toHaveBeenCalledWith('file:///x/model.gguf.tmp');
  });

  it('requires GGUF magic bytes for unknown-size custom models', async () => {
    mockedGetInfo.mockResolvedValue({ exists: true, size: 50_000_000 });
    mockedRead.mockResolvedValue('R0dVRg=='); // "GGUF"
    expect(await isModelFileValid(customModel)).toBe(true);

    mockedRead.mockResolvedValue('PCFET0M='); // "<!DOC"
    expect(await isModelFileValid(customModel)).toBe(false);
  });

  it('rejects tiny unknown-size files without reading them', async () => {
    mockedGetInfo.mockResolvedValue({ exists: true, size: 5_000 });
    expect(await isModelFileValid(customModel)).toBe(false);
    expect(mockedRead).not.toHaveBeenCalled();
  });

  it('treats filesystem errors as invalid', async () => {
    mockedGetInfo.mockRejectedValue(new Error('boom'));
    expect(await isModelFileValid(catalogModel)).toBe(false);
  });
});

describe('getModelMinValidBytes', () => {
  it('is 95% of the catalog size, never below a 1MB floor', () => {
    expect(getModelMinValidBytes({ sizeBytes: 1_000_000_000 })).toBe(950_000_000);
    expect(getModelMinValidBytes({ sizeBytes: 1000 })).toBe(1024 * 1024);
    expect(getModelMinValidBytes({ sizeBytes: 0 })).toBe(1024 * 1024);
  });
});
