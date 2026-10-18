/* eslint-disable @typescript-eslint/no-require-imports */
// downloadService: reattach after restart, finalize validation, cancel vs
// auto-retry, and the startup temp-file sweep. The background downloader is
// replaced with scriptable fake tasks.

type Handler = (params: any) => void;

class FakeTask {
  handlers: Record<string, Handler> = {};
  started = false;
  stopped = false;
  constructor(
    public id: string,
    public state: string = 'PENDING',
    public destination?: string,
    public bytesDownloaded = 0,
    public bytesTotal = 0,
  ) {}
  begin(h: Handler) { this.handlers.begin = h; return this; }
  progress(h: Handler) { this.handlers.progress = h; return this; }
  done(h: Handler) { this.handlers.done = h; return this; }
  error(h: Handler) { this.handlers.error = h; return this; }
  start() { this.started = true; this.state = 'DOWNLOADING'; }
  async stop() { this.stopped = true; this.state = 'STOPPED'; }
  async pause() { this.state = 'PAUSED'; }
  async resume() { this.state = 'DOWNLOADING'; }
}

const mockDownloader: {
  existing: FakeTask[];
  created: FakeTask[];
  createDownloadTask: jest.Mock;
  getExistingDownloadTasks: jest.Mock;
  completeHandler: jest.Mock;
  setConfig: jest.Mock;
} = {
  existing: [],
  created: [],
  createDownloadTask: jest.fn(({ id, destination }: { id: string; destination: string }): FakeTask => {
    const task = new FakeTask(id, 'PENDING', destination);
    mockDownloader.created.push(task);
    return task;
  }),
  getExistingDownloadTasks: jest.fn(async (): Promise<FakeTask[]> => mockDownloader.existing),
  completeHandler: jest.fn(),
  setConfig: jest.fn(),
};

jest.mock('@kesha-antonov/react-native-background-downloader', () => mockDownloader);

// In-memory filesystem: path -> size
const mockFiles = new Map<string, number>();
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///docs/',
  getInfoAsync: jest.fn(async (path: string) => {
    if (path.endsWith('/')) return { exists: true, isDirectory: true };
    return mockFiles.has(path) ? { exists: true, size: mockFiles.get(path) } : { exists: false };
  }),
  getFreeDiskStorageAsync: jest.fn(async () => 1e12),
  makeDirectoryAsync: jest.fn(async () => {}),
  deleteAsync: jest.fn(async (path: string) => {
    mockFiles.delete(path);
  }),
  moveAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => {
    mockFiles.set(to, mockFiles.get(from)!);
    mockFiles.delete(from);
  }),
  readDirectoryAsync: jest.fn(async (dir: string) =>
    [...mockFiles.keys()].filter(p => p.startsWith(dir)).map(p => p.slice(dir.length)),
  ),
  // Downloaded files in these tests are real GGUFs ("GGUF" magic).
  readAsStringAsync: jest.fn(async () => 'R0dVRg=='),
  createDownloadResumable: jest.fn(),
}));

jest.mock('../analyticsService', () => ({
  analyticsService: new Proxy({}, { get: () => jest.fn(async () => {}) }),
}));

import { getModelById } from '@/constants/models';

const model = getModelById('gemma3-1b')!;
const finalPath = `file:///docs/models/${model.modelFilename}`;
const tempPath = `${finalPath}.tmp`;

function loadService() {
  let service: typeof import('../downloadService').downloadService;
  jest.isolateModules(() => {
    service = require('../downloadService').downloadService;
  });
  return service!;
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

beforeEach(() => {
  mockFiles.clear();
  mockDownloader.existing = [];
  mockDownloader.created = [];
  jest.clearAllMocks();
});

describe('reattach after restart', () => {
  it('finalizes a task that finished while the app was dead, using a rebuilt temp path', async () => {
    // The downloader reports destinations without the file:// scheme.
    mockDownloader.existing = [
      new FakeTask(model.id, 'DONE', tempPath.replace('file://', ''), model.sizeBytes, model.sizeBytes),
    ];
    mockFiles.set(tempPath, model.sizeBytes);
    const service = loadService();

    await service.initialize();
    await flush();
    await flush();

    expect(mockFiles.get(finalPath)).toBe(model.sizeBytes);
    expect(service.getState()).toMatchObject({ status: 'completed', modelId: model.id, reattached: true });
    expect(mockDownloader.completeHandler).toHaveBeenCalledWith(model.id);
  });

  it('restores a paused task as paused and treats it as busy', async () => {
    mockDownloader.existing = [new FakeTask(model.id, 'PAUSED', undefined, 100, model.sizeBytes)];
    mockFiles.set(tempPath, 100);
    const service = loadService();
    await service.initialize();

    expect(service.getState().status).toBe('paused');
    expect(service.isBusy()).toBe(true);
    expect(await service.startDownload(getModelById('qwen35-2b')!)).toBe(false);
    // The paused temp file survives the startup sweep.
    expect(mockFiles.has(tempPath)).toBe(true);
  });
});

describe('finalize validation', () => {
  it('rejects a body far smaller than the model (captive portal) even without a server total', async () => {
    const service = loadService();
    const result = service.startDownload(model);
    await flush();
    const task = mockDownloader.created[0];
    mockFiles.set(tempPath, 5_000);
    task.handlers.done({ bytesDownloaded: 5_000, bytesTotal: -1 });

    expect(await result).toBe(false);
    expect(service.getState().status).toBe('failed');
    expect(mockFiles.has(finalPath)).toBe(false);
    expect(mockFiles.has(tempPath)).toBe(false);
  });

  it('does not report an invalid existing file as already downloaded', async () => {
    mockFiles.set(finalPath, 5_000);
    const service = loadService();
    void service.startDownload(model);
    await flush();
    expect(mockFiles.has(finalPath)).toBe(false);
    expect(mockDownloader.created).toHaveLength(1);
  });
});

describe('cancel vs auto-retry', () => {
  it('a cancel during the retry wait resolves false and never restarts', async () => {
    jest.useFakeTimers();
    try {
      const service = loadService();
      const result = service.startDownload(model);
      await jest.advanceTimersByTimeAsync(0);
      mockDownloader.created[0].handlers.error({ error: 'network timeout', errorCode: 0 });
      expect(service.isBusy()).toBe(true);

      await service.cancelDownload();
      expect(await result).toBe(false);

      await jest.advanceTimersByTimeAsync(2000);
      expect(mockDownloader.created).toHaveLength(1);
      expect(service.getState().status).toBe('idle');
    } finally {
      jest.useRealTimers();
    }
  });

  it('a cancel mid-download resolves the pending startDownload promise', async () => {
    const service = loadService();
    const result = service.startDownload(model);
    await flush();
    await service.cancelDownload();
    expect(await result).toBe(false);
    expect(mockDownloader.created[0].stopped).toBe(true);
  });
});

describe('startup sweep', () => {
  it('deletes stale temp files not owned by an active task', async () => {
    mockFiles.set('file:///docs/models/old.gguf.tmp', 10);
    mockFiles.set('file:///docs/models/mmproj.gguf.part', 10);
    mockFiles.set('file:///docs/models/keep.gguf', 10);
    const service = loadService();
    await service.initialize();

    expect(mockFiles.has('file:///docs/models/old.gguf.tmp')).toBe(false);
    expect(mockFiles.has('file:///docs/models/mmproj.gguf.part')).toBe(false);
    expect(mockFiles.has('file:///docs/models/keep.gguf')).toBe(true);
  });
});
