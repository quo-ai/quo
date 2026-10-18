// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '../../chat/types';
import { fromWire, toWire } from '../adapters';
import { decryptRecord, deriveKey, encryptRecord, makeVerifier, newRecoveryKey, webCodec } from '../crypto';
import { SyncEngine, SyncStateError, type KindStore, type SyncApi, type Tracked, type TrackingStore } from '../engine';
import { chatKind, memoryKind, type Storage } from '../kinds';
import type { WireChat, WireMemory } from '../wire';

// The real server code and database (in memory), so the client and server are tested against each other.
vi.stubEnv('OPENROUTER_API_KEY', '');
vi.stubEnv('PADDLE_API_KEY', '');
vi.stubEnv('RESEND_API_KEY', '');

let handleApi: typeof import('../../../server/routes.js').handleApi;
let getDb: typeof import('../../../server/db.js').getDb;
let cookie = '';

async function call(method: string, path: string, body?: unknown) {
  const response = await handleApi(new Request(`http://localhost/api/${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-quo-device': randomUUID(), 'x-forwarded-for': '10.0.0.3', 'sec-fetch-site': 'same-origin', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), path.split('?')[0]);
  if (!response.ok && response.status !== 302) throw Object.assign(new Error(`${path}: ${response.status}`), { status: response.status, body: await response.json() });
  return response;
}

const api: SyncApi = {
  status: async () => (await call('GET', 'sync/status')).json(),
  pull: async (since, kinds) => (await call('GET', `sync/pull?since=${since}&kinds=${kinds.join(',')}`)).json(),
  push: async records => (await call('POST', 'sync/push', { records })).json(),
};

class Device {
  /** The web app's own chats (with attachment contents), and the wire-format memories a phone would keep. */
  chats = new Map<string, Conversation>();
  memories = new Map<string, WireMemory>();
  tracked = new Map<string, Tracked>();
  seq = 0;
  engine!: SyncEngine;
  pushHook: (() => Promise<void>) | null = null;

  static async join(key: CryptoKey, options: { memories?: boolean } = {}): Promise<Device> {
    const device = new Device();
    const chatStorage: Storage<WireChat> = {
      get: async id => (device.chats.has(id) ? toWire(device.chats.get(id)!) : undefined),
      put: async wire => void device.chats.set(wire.id, structuredClone(fromWire(wire, device.chats.get(wire.id)))),
      remove: async id => void device.chats.delete(id),
      all: async () => [...device.chats.values()].map(toWire),
    };
    const memoryStorage: Storage<WireMemory> = {
      get: async id => device.memories.get(id),
      put: async memory => void device.memories.set(memory.id, structuredClone(memory)),
      remove: async id => void device.memories.delete(id),
      all: async () => [...device.memories.values()],
    };
    const tracking: TrackingStore = {
      get: async id => device.tracked.get(id),
      put: async record => void device.tracked.set(record.id, { ...record }),
      remove: async id => void device.tracked.delete(id),
      dirty: async () => [...device.tracked.values()].filter(r => r.dirty),
      getSeq: async () => device.seq,
      setSeq: async seq => void (device.seq = seq),
    };
    const stores: KindStore<any>[] = [chatKind(chatStorage), ...(options.memories ? [memoryKind(memoryStorage)] : [])]; // eslint-disable-line @typescript-eslint/no-explicit-any
    const wrapped: SyncApi = { ...api, push: async records => { await device.pushHook?.(); return api.push(records); } };
    device.engine = new SyncEngine({ api: wrapped, codec: webCodec(key), stores, tracking, newId: () => randomUUID() });
    return device;
  }

  /** What the app does when the user saves a chat. */
  async save(chat: Conversation) {
    this.chats.set(chat.id, structuredClone(chat));
    await this.engine.markChanged('chat', chat.id, false);
  }

  async remove(id: string) {
    this.chats.delete(id);
    await this.engine.markChanged('chat', id, true);
  }

  async remember(memory: WireMemory) {
    this.memories.set(memory.id, structuredClone(memory));
    await this.engine.markChanged('memory', memory.id, false);
  }

  async forget(id: string) {
    this.memories.delete(id);
    await this.engine.markChanged('memory', id, true);
  }

  texts(): string[] {
    return [...this.chats.values()].flatMap(chat => chat.messages.map(m => m.content)).sort();
  }
}

let clock = 1_000;
const chat = (id: string, title: string, ...messages: string[]): Conversation => ({
  id, title, createdAt: ++clock, updatedAt: ++clock,
  messages: messages.map((content, i) => ({ id: `${id}-m${i}`, role: i % 2 ? 'assistant' : 'user', content })),
});
const append = (conversation: Conversation, content: string, id: string): Conversation => ({
  ...conversation, updatedAt: ++clock, messages: [...conversation.messages, { id, role: 'user', content }],
});

describe('Quo Sync between devices', () => {
  const recovery = newRecoveryKey();
  let key: CryptoKey;

  beforeAll(async () => {
    ({ handleApi } = await import('../../../server/routes.js'));
    ({ getDb } = await import('../../../server/db.js'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const start = await (await call('POST', 'auth/start', { email: 'sync@example.com' })).json();
    const verify = await call('POST', 'auth/verify', { email: 'sync@example.com', code: start.devCode });
    cookie = verify.headers.get('set-cookie')!.split(';')[0];
    const { url } = await (await call('POST', 'billing/checkout', { product: 'sync_yearly' })).json();
    await call('GET', url.replace('/api/', ''));
    key = await deriveKey(recovery.secret);
    await call('POST', 'sync/setup', { verifier: await makeVerifier(key) });
  });

  it('uploads one device’s chats and downloads them on another, with the server seeing only ciphertext', async () => {
    const phone = await Device.join(key);
    const laptop = await Device.join(await deriveKey(recovery.secret));
    await phone.save(chat('11111111-aaaa', 'Trip plan', 'Where should we go in March? — my private plan', 'Lisbon.'));
    await phone.save(chat('11111111-bbbb', 'Recipe', 'How do I make flatbread?'));
    expect(await phone.engine.run()).toMatchObject({ pushed: 2, pulled: 0 });

    const report = await laptop.engine.run();
    expect(report).toMatchObject({ pulled: 2, changed: true, skipped: 0 });
    expect(laptop.chats.get('11111111-aaaa')).toEqual(phone.chats.get('11111111-aaaa'));
    expect(laptop.texts()).toEqual(phone.texts());

    const db = await getDb();
    const rows = await db.query<{ blob: string }>('select blob from sync_records');
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const row of rows) {
      const raw = Buffer.from(row.blob, 'base64').toString('latin1');
      expect(raw).not.toContain('private plan');
      expect(raw).not.toContain('Lisbon');
    }
  });

  it('carries edits both ways', async () => {
    const a = await Device.join(key);
    const b = await Device.join(key);
    await a.engine.run();
    await b.engine.run();
    const id = '22222222-aaaa';
    await a.save(chat(id, 'Notes', 'one'));
    await a.engine.run();
    await b.engine.run();
    await b.save(append(b.chats.get(id)!, 'two, from B', 'm-b'));
    await b.engine.run();
    await a.engine.run();
    expect(a.chats.get(id)!.messages.map(m => m.content)).toEqual(['one', 'two, from B']);
    expect((await a.engine.run()).pushed).toBe(0); // nothing left to do
  });

  it('keeps both sides when two devices edit the same chat at once', async () => {
    const a = await Device.join(key);
    const b = await Device.join(key);
    const id = '33333333-aaaa';
    await a.save(chat(id, 'Shared', 'start'));
    await a.engine.run();
    await b.engine.run();

    await a.save(append(a.chats.get(id)!, 'A says hello', 'm-a'));
    await b.save(append(b.chats.get(id)!, 'B says hi', 'm-b'));
    await a.engine.run(); // A reaches the server first
    await b.engine.run(); // B's edit conflicts, so B pulls, merges and uploads
    await a.engine.run();
    await b.engine.run();

    for (const device of [a, b]) {
      const texts = device.texts().filter(t => /says/.test(t));
      expect(texts).toEqual(['A says hello', 'B says hi']); // nothing lost, nothing duplicated
    }
    expect([...a.chats.keys()].sort()).toEqual([...b.chats.keys()].sort()); // and both devices agree
    const titles = [...a.chats.values()].filter(c => c.id.startsWith('33333333') || c.title.startsWith('Shared')).map(c => c.title).sort();
    expect(titles).toEqual(['Shared', 'Shared (other device)']);
  });

  it('extends a chat both devices continued from the same point without making copies', async () => {
    const a = await Device.join(key);
    const b = await Device.join(key);
    const id = '44444444-aaaa';
    await a.save(chat(id, 'Linear', 'q1', 'a1'));
    await a.engine.run();
    await b.engine.run();
    await a.save(append(a.chats.get(id)!, 'q2', 'm2'));
    await a.engine.run();
    await b.save(b.chats.get(id)!); // B touched it without adding anything
    await b.engine.run();
    expect(b.chats.get(id)!.messages.map(m => m.content)).toEqual(['q1', 'a1', 'q2']);
    expect([...b.chats.values()].filter(c => c.title.startsWith('Linear'))).toHaveLength(1);
  });

  it('propagates deletions, and keeps a chat that was edited where it was deleted elsewhere', async () => {
    const a = await Device.join(key);
    const b = await Device.join(key);
    const gone = '55555555-aaaa';
    const kept = '55555555-bbbb';
    await a.save(chat(gone, 'Delete me', 'x'));
    await a.save(chat(kept, 'Keep me', 'y'));
    await a.engine.run();
    await b.engine.run();

    await a.remove(gone);
    await a.remove(kept);
    await b.save(append(b.chats.get(kept)!, 'but I added this', 'm-keep'));
    await a.engine.run();
    await b.engine.run();
    await a.engine.run();

    expect(b.chats.has(gone)).toBe(false);
    expect(a.chats.has(gone)).toBe(false);
    expect(a.chats.get(kept)!.messages.map(m => m.content)).toEqual(['y', 'but I added this']);
    expect(b.chats.get(kept)!.messages).toHaveLength(2);
  });

  it('does not tell the server about a chat that was created and deleted before any sync', async () => {
    const a = await Device.join(key);
    await a.save(chat('66666666-aaaa', 'Oops', 'never mind'));
    await a.remove('66666666-aaaa');
    expect((await a.engine.run()).pushed).toBe(0);
    expect(a.tracked.has('66666666-aaaa')).toBe(false);
  });

  it('leaves attachment contents on the device they were added on', async () => {
    const a = await Device.join(key);
    const b = await Device.join(key);
    const id = '77777777-aaaa';
    const withImage = chat(id, 'Photo', 'what is this?');
    withImage.messages[0].attachments = [{ id: 'att-1', kind: 'image', name: 'cat.jpg', dataUrl: 'data:image/jpeg;base64,AAAA', width: 10, height: 10 }];
    await a.save(withImage);
    await a.engine.run();
    await b.engine.run();

    const seen = b.chats.get(id)!.messages[0].attachments![0];
    expect(seen).toMatchObject({ name: 'cat.jpg', omitted: true });
    expect(seen.dataUrl).toBeUndefined();

    const db = await getDb();
    const [row] = await db.query<{ blob: string }>('select blob from sync_records where id = $1', [id]);
    expect(JSON.stringify(await decryptRecord(key, 'chat', id, row.blob))).not.toContain('AAAA');

    // B continues the chat; A gets the new message and still has its own photo.
    await b.save(append(b.chats.get(id)!, 'a cat', 'm-cat'));
    await b.engine.run();
    await a.engine.run();
    const mine = a.chats.get(id)!;
    expect(mine.messages).toHaveLength(2);
    expect(mine.messages[0].attachments![0].dataUrl).toBe('data:image/jpeg;base64,AAAA');
  });

  it('does not lose an edit made while an upload is in flight', async () => {
    const a = await Device.join(key);
    const id = '88888888-aaaa';
    await a.save(chat(id, 'Busy', 'first'));
    a.pushHook = async () => {
      a.pushHook = null;
      await a.save(append(a.chats.get(id)!, 'typed during the upload', 'm-late'));
    };
    await a.engine.run();
    expect(a.tracked.get(id)!.dirty).toBe(true);
    await a.engine.run();
    expect(a.tracked.get(id)!.dirty).toBe(false);

    const b = await Device.join(key);
    await b.engine.run();
    expect(b.chats.get(id)!.messages.map(m => m.content)).toEqual(['first', 'typed during the upload']);
  });

  it('skips a chat too large to sync and says so', async () => {
    const a = await Device.join(key);
    const noise = randomBytes(1_900_000).toString('base64'); // doesn't compress
    await a.save(chat('99999999-aaaa', 'Huge', noise));
    const report = await a.engine.run();
    expect(report.tooLarge).toBe(1);
    expect(a.tracked.get('99999999-aaaa')).toMatchObject({ dirty: false, tooLarge: true });
  });

  it('handles more chats than fit in one page or one upload', async () => {
    const a = await Device.join(key);
    const b = await Device.join(key);
    for (let i = 0; i < 130; i++) await a.save(chat(`bulk${String(i).padStart(4, '0')}-xxxx`, `Bulk ${i}`, `message ${i}`));
    expect((await a.engine.run()).pushed).toBe(130);
    await b.engine.run();
    expect([...b.chats.keys()].filter(id => id.startsWith('bulk'))).toHaveLength(130);
  });

  it('refuses to sync with the wrong recovery key', async () => {
    const stranger = await Device.join(await deriveKey(newRecoveryKey().secret));
    await expect(stranger.engine.run()).rejects.toMatchObject({ code: 'key_changed' });
    expect(stranger.chats.size).toBe(0);
  });

  it('notices when the cloud copy was deleted or started over', async () => {
    const a = await Device.join(key);
    await a.engine.run();
    await call('POST', 'sync/reset', {});
    await expect(a.engine.run()).rejects.toBeInstanceOf(SyncStateError);
    await expect(a.engine.run()).rejects.toMatchObject({ code: 'cloud_reset' });

    // Started over with a new recovery key: the old key is no longer the right one.
    const fresh = newRecoveryKey();
    const freshKey = await deriveKey(fresh.secret);
    await call('POST', 'sync/setup', { verifier: await makeVerifier(freshKey) });
    await expect(a.engine.run()).rejects.toMatchObject({ code: 'key_changed' });
    const other = await Device.join(freshKey);
    await expect(other.engine.run()).resolves.toMatchObject({ pulled: 0 });
  });

  describe('memories', () => {
    beforeAll(async () => {
      // The test above started the account over with another key; start again with this suite's.
      await call('POST', 'sync/reset', {});
      await call('POST', 'sync/setup', { verifier: await makeVerifier(key) });
    });

    const memory = (id: string, content: string, at: number): WireMemory => ({ id, content, createdAt: 1_000, updatedAt: at });

    it('sync between devices that keep them, under their own prefixed ids', async () => {
      const phone = await Device.join(key, { memories: true });
      const phone2 = await Device.join(key, { memories: true });
      await phone.remember(memory('mem_1760000000000_aaaaaa', 'My name is Sam', 10));
      await phone.remember(memory('mem_1760000000001_bbbbbb', 'I prefer metric units', 11));
      expect(await phone.engine.run()).toMatchObject({ pushed: 2 });
      await phone2.engine.run();
      expect([...phone2.memories.values()].map(m => m.content).sort()).toEqual(['I prefer metric units', 'My name is Sam']);
      expect([...phone.tracked.keys()].filter(id => id.startsWith('memory:'))).toHaveLength(2);
    });

    it('take the later edit when two devices change the same one, and carry deletions', async () => {
      const a = await Device.join(key, { memories: true });
      const b = await Device.join(key, { memories: true });
      const id = 'mem_1760000000010_cccccc';
      await a.remember(memory(id, 'Lives in Leeds', 10));
      await a.engine.run();
      await b.engine.run();

      await a.remember(memory(id, 'Lives in York', 20));
      await b.remember(memory(id, 'Lives in Hull', 30)); // later
      await a.engine.run();
      await b.engine.run();
      await a.engine.run();
      expect(a.memories.get(id)!.content).toBe('Lives in Hull');
      expect(b.memories.get(id)!.content).toBe('Lives in Hull');

      await a.forget(id);
      await a.engine.run();
      await b.engine.run();
      expect(b.memories.has(id)).toBe(false);
    });

    it('are ignored, not reported as unreadable, by a device that has no memories', async () => {
      const phone = await Device.join(key, { memories: true });
      await phone.remember(memory('mem_1760000000020_dddddd', 'Likes tea', 10));
      await phone.engine.run();
      const web = await Device.join(key); // chats only
      const report = await web.engine.run();
      expect(report.skipped).toBe(0);
      expect(web.memories.size).toBe(0);
      // And it can't clobber them either: its own uploads leave the memory alone.
      await web.save(chat('aaaa0000-memtest', 'A chat', 'hello'));
      await web.engine.run();
      const again = await Device.join(key, { memories: true });
      await again.engine.run();
      expect(again.memories.get('mem_1760000000020_dddddd')?.content).toBe('Likes tea');
    });

    it('do not reach an older client that never asks for them', async () => {
      const phone = await Device.join(key, { memories: true });
      await phone.remember(memory('mem_1760000000030_eeeeee', 'Secret-ish', 10));
      await phone.engine.run();
      // An older app calls pull without `kinds`.
      const response = await (await call('GET', 'sync/pull?since=0&limit=100')).json();
      expect(response.records.every((r: { kind: string }) => r.kind === 'chat')).toBe(true);
    });

    it('that are not really memories are skipped safely', async () => {
      const phone = await Device.join(key, { memories: true });
      // A record under a memory id whose contents aren't that memory (as a buggy or hostile client might upload).
      const id = 'memory:mem_1760000000040_ffffff';
      const blob = await encryptRecord(key, 'memory', id, { id: 'mem_other', content: 'x', createdAt: 1, updatedAt: 1 });
      await call('POST', 'sync/push', { records: [{ id, kind: 'memory', blob, deleted: false, baseSeq: 0 }] });
      const report = await phone.engine.run();
      expect(report.skipped).toBeGreaterThanOrEqual(1);
      expect(phone.memories.has('mem_1760000000040_ffffff')).toBe(false);
    });
  });
});
