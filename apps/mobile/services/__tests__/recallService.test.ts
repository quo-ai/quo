import AsyncStorage from '@react-native-async-storage/async-storage';
import { initLlama } from 'llama.rn';
import { cosineSimilarity } from '@/utils/vector';
import {
  recallService,
  quantizeVector,
  dequantizeVector,
  encodeInt8,
  decodeInt8,
  evictIndexEntries,
  RECALL_MODEL,
} from '../recallService';
import type { Conversation } from '@/types/chat';

jest.mock('../analyticsService', () => ({
  analyticsService: { track: jest.fn(async () => {}) },
}));

// In-memory file system (the global jest.setup mock has no read/write/move).
const mockFiles = new Map<string, string | number>();
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///test-documents/',
  getInfoAsync: jest.fn(async (path: string) => {
    if (!mockFiles.has(path)) return { exists: false };
    const v = mockFiles.get(path)!;
    return { exists: true, size: typeof v === 'number' ? v : v.length };
  }),
  readAsStringAsync: jest.fn(async (path: string) => {
    const v = mockFiles.get(path);
    if (typeof v !== 'string') throw new Error('not found');
    return v;
  }),
  writeAsStringAsync: jest.fn(async (path: string, data: string) => {
    mockFiles.set(path, data);
  }),
  moveAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => {
    if (!mockFiles.has(from)) throw new Error('missing source');
    mockFiles.set(to, mockFiles.get(from)!);
    mockFiles.delete(from);
  }),
  makeDirectoryAsync: jest.fn(async () => {}),
  deleteAsync: jest.fn(async (path: string) => {
    for (const key of [...mockFiles.keys()]) {
      if (key === path || key.startsWith(path.endsWith('/') ? path : `${path}/`)) mockFiles.delete(key);
    }
  }),
}));

const DIR = 'file:///test-documents/recall/';
const MODEL_PATH = `file:///test-documents/models/${RECALL_MODEL.filename}`;

function randomVector(seed: number, dim = 768): number[] {
  let x = seed;
  return Array.from({ length: dim }, () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return (x / 2147483648) * 2 - 1;
  });
}

function makeConversation(id: string, count: number): Conversation {
  return {
    id,
    title: 't',
    messages: Array.from({ length: count }, (_, i) => ({
      id: `m${i}`,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `message number ${i} with enough content to be indexed`,
      timestamp: i,
    })),
  } as unknown as Conversation;
}

describe('vector quantization', () => {
  it('round-trips through base64 with near-identical similarity', () => {
    const a = randomVector(1);
    const b = randomVector(2).map((x, i) => x * 0.3 + a[i] * 0.7);
    const qa = quantizeVector(a);
    const qb = quantizeVector(b);
    const da = dequantizeVector(decodeInt8(encodeInt8(qa.q)), qa.scale);
    const db = dequantizeVector(decodeInt8(encodeInt8(qb.q)), qb.scale);

    expect(cosineSimilarity(da, a)).toBeGreaterThan(0.999);
    expect(Math.abs(cosineSimilarity(da, db) - cosineSimilarity(a, b))).toBeLessThan(0.01);
  });

  it('preserves sign and extremes through encoding', () => {
    const q = new Int8Array([-127, -1, 0, 1, 127, -128]);
    expect(Array.from(decodeInt8(encodeInt8(q)))).toEqual(Array.from(q));
  });

  it('handles the zero vector', () => {
    const { scale, q } = quantizeVector([0, 0, 0]);
    expect(scale).toBe(0);
    expect(dequantizeVector(q, scale)).toEqual([0, 0, 0]);
  });

  it('is compact: a 768-dim vector encodes to ~1KB', () => {
    expect(encodeInt8(quantizeVector(randomVector(3)).q).length).toBe(1024);
  });
});

describe('evictIndexEntries', () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `m${i}`);

  it('drops entries for deleted messages first', () => {
    const entries = [{ id: 'm0' }, { id: 'gone' }, { id: 'm2' }];
    const { kept, evicted } = evictIndexEntries(entries, ids(3), 10);
    expect(kept.map(e => e.id)).toEqual(['m0', 'm2']);
    expect(evicted).toEqual(['gone']);
  });

  it('returns entries in conversation order', () => {
    const entries = [{ id: 'm3' }, { id: 'm1' }, { id: 'm2' }];
    expect(evictIndexEntries(entries, ids(4), 10).kept.map(e => e.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('thins evenly instead of dropping the oldest block', () => {
    const entries = ids(100).map(id => ({ id }));
    const { kept, evicted } = evictIndexEntries(entries, ids(100), 90);
    expect(kept).toHaveLength(90);
    expect(evicted).toHaveLength(10);
    // Oldest messages keep coverage; evictions are spread across history.
    expect(kept[0].id).toBe('m0');
    const positions = evicted.map(id => Number(id.slice(1)));
    expect(Math.max(...positions) - Math.min(...positions)).toBeGreaterThan(80);
  });

  it('is a no-op under the cap', () => {
    const entries = ids(5).map(id => ({ id }));
    const { kept, evicted } = evictIndexEntries(entries, ids(5), 5);
    expect(kept).toHaveLength(5);
    expect(evicted).toHaveLength(0);
  });
});

describe('recallService storage', () => {
  const embedding = jest.fn(async (text: string) => ({
    embedding: randomVector(text.length + 7),
  }));

  beforeEach(async () => {
    mockFiles.clear();
    await AsyncStorage.clear();
    await recallService.clearAllIndexes();
    await recallService.release();
    embedding.mockClear();
    (initLlama as jest.Mock).mockResolvedValue({
      embedding,
      release: jest.fn(async () => {}),
    });
    mockFiles.set(MODEL_PATH, RECALL_MODEL.sizeBytes);
    await recallService.setEnabled(true);
  });

  it('migrates a legacy AsyncStorage index to a file and removes the key', async () => {
    const legacy = [
      { id: 'm0', role: 'user', snippet: 'hello', v: randomVector(10) },
      { id: 'm1', role: 'assistant', snippet: 'world', v: randomVector(11) },
    ];
    await AsyncStorage.setItem('local_ai_recall_index:c1', JSON.stringify(legacy));

    // recall() loads the index, which triggers migration.
    await recallService.recall(makeConversation('c1', 4), 'question', 2);

    expect(await AsyncStorage.getItem('local_ai_recall_index:c1')).toBeNull();
    const file = JSON.parse(mockFiles.get(`${DIR}c1.json`) as string);
    expect(file.version).toBe(2);
    expect(file.entries.map((e: { id: string }) => e.id)).toEqual(['m0', 'm1']);
    expect(typeof file.entries[0].q).toBe('string');
    expect(file.processed).toEqual(['m0', 'm1']);
  });

  it('keeps the legacy key when the file write fails', async () => {
    const fs = jest.requireMock('expo-file-system/legacy');
    await AsyncStorage.setItem(
      'local_ai_recall_index:c2',
      JSON.stringify([{ id: 'm0', role: 'user', snippet: 's', v: randomVector(1) }]),
    );
    fs.writeAsStringAsync.mockRejectedValueOnce(new Error('disk full'));

    await recallService.recall(makeConversation('c2', 2), 'q', 1);

    expect(await AsyncStorage.getItem('local_ai_recall_index:c2')).not.toBeNull();
  });

  it('indexes newest first, never re-embeds processed messages, and stores to file', async () => {
    const conv = makeConversation('c3', 20);
    await recallService.indexConversation(conv);
    expect(embedding).toHaveBeenCalledTimes(8);
    expect(embedding.mock.calls[0][0]).toContain('message number 19');

    for (let i = 0; i < 5; i++) await recallService.indexConversation(conv);
    expect(embedding).toHaveBeenCalledTimes(20);

    // Fully processed: further passes embed nothing.
    await recallService.indexConversation(conv);
    expect(embedding).toHaveBeenCalledTimes(20);

    const file = JSON.parse(mockFiles.get(`${DIR}c3.json`) as string);
    expect(file.entries).toHaveLength(20);
    expect(file.entries[0].id).toBe('m0');
  });

  it('deleteIndex removes the file, legacy key and cache', async () => {
    const conv = makeConversation('c4', 4);
    await recallService.indexConversation(conv);
    await AsyncStorage.setItem('local_ai_recall_index:c4', '[]');
    expect(mockFiles.has(`${DIR}c4.json`)).toBe(true);

    await recallService.deleteIndex('c4');

    expect(mockFiles.has(`${DIR}c4.json`)).toBe(false);
    expect(await AsyncStorage.getItem('local_ai_recall_index:c4')).toBeNull();
    // Cache cleared: everything is re-embedded on the next pass.
    embedding.mockClear();
    await recallService.indexConversation(conv);
    expect(embedding).toHaveBeenCalledTimes(4);
  });

  it('recall returns matches from the covered range', async () => {
    const conv = makeConversation('c5', 4);
    await recallService.indexConversation(conv);
    // Query embedding identical to message m0's vector.
    const text = conv.messages[0].content;
    embedding.mockImplementationOnce(async () => ({ embedding: randomVector(`search_document: ${text}`.length + 7) }));
    const result = await recallService.recall(conv, 'anything', 2);
    expect(result).toContain('User said earlier');
  });
});
