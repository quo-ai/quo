// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
// The web and desktop apps' side...
import { fromWire, toWire } from '../src/sync/adapters';
import type { Conversation } from '../src/chat/types';
import { deriveKey as webDeriveKey, makeVerifier as webMakeVerifier, webCodec } from '../src/sync/crypto';
import { SyncEngine, type KindStore, type SyncApi, type Tracked, type TrackingStore } from '../src/sync/engine';
import { chatKind, memoryKind, type Storage } from '../src/sync/kinds';
import { parseRecoveryKey } from '../src/sync/recovery';
import type { WireChat, WireMemory } from '../src/sync/wire';
// ...and the phone app's own code (apps/mobile/services/sync), not a re-implementation of it.
import { chatFingerprint, fromWireChat, fromWireMemory, toWireChat, toWireMemory } from '../../mobile/services/sync/convert';
import { checkVerifier as phoneCheckVerifier, deriveKey as phoneDeriveKey, makeVerifier as phoneMakeVerifier, mobileCodec, newRecoveryKey as phoneNewRecoveryKey } from '../../mobile/services/sync/crypto';
import type { Conversation as PhoneConversation } from '../../mobile/types/chat';

/**
 * A phone and the web/desktop app sharing one account on the real server and
 * database. Each side uses its own encryption, its own conversion between its
 * chats and the wire format, and the shared engine, so this is the test that
 * "Quo Sync works between the Android app and the web and desktop apps".
 */

vi.stubEnv('OPENROUTER_API_KEY', '');
vi.stubEnv('PADDLE_API_KEY', '');
vi.stubEnv('RESEND_API_KEY', '');

let handleApi: typeof import('../server/routes.js').handleApi;
let cookie = '';

async function call(method: string, path: string, body?: unknown) {
  const response = await handleApi(new Request(`http://localhost/api/${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-quo-device': randomUUID(), 'x-forwarded-for': '10.0.0.9', 'sec-fetch-site': 'same-origin', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), path.split('?')[0]);
  if (!response.ok && response.status !== 302) throw Object.assign(new Error(`${path}: ${response.status}`), { status: response.status });
  return response;
}

const api: SyncApi = {
  status: async () => (await call('GET', 'sync/status')).json(),
  pull: async (since, kinds) => (await call('GET', `sync/pull?since=${since}&kinds=${kinds.join(',')}`)).json(),
  push: async records => (await call('POST', 'sync/push', { records })).json(),
};

function memoryTracking(device: { tracked: Map<string, Tracked>; seq: number }): TrackingStore {
  return {
    get: async id => device.tracked.get(id),
    put: async record => void device.tracked.set(record.id, { ...record }),
    remove: async id => void device.tracked.delete(id),
    dirty: async () => [...device.tracked.values()].filter(r => r.dirty),
    getSeq: async () => device.seq,
    setSeq: async seq => void (device.seq = seq),
  };
}

/** The web or desktop app: chats in the web app's shape, WebCrypto, the web adapters. No memories feature. */
class WebDevice {
  chats = new Map<string, Conversation>();
  tracked = new Map<string, Tracked>();
  seq = 0;
  engine: SyncEngine;
  constructor(key: CryptoKey) {
    const storage: Storage<WireChat> = {
      get: async id => (this.chats.has(id) ? toWire(this.chats.get(id)!) : undefined),
      put: async wire => void this.chats.set(wire.id, structuredClone(fromWire(wire, this.chats.get(wire.id)))),
      remove: async id => void this.chats.delete(id),
      all: async () => [...this.chats.values()].map(toWire),
    };
    this.engine = new SyncEngine({ api, codec: webCodec(key), stores: [chatKind(storage)], tracking: memoryTracking(this), newId: () => randomUUID() });
  }
  async save(chat: Conversation) {
    this.chats.set(chat.id, structuredClone(chat));
    await this.engine.markChanged('chat', chat.id, false);
  }
  async remove(id: string) {
    this.chats.delete(id);
    await this.engine.markChanged('chat', id, true);
  }
}

/** The Android app: its own chat shape (thinking inline, photos by uri), noble/fflate crypto, the phone's conversions. */
class Phone {
  chats = new Map<string, PhoneConversation>();
  memories = new Map<string, { id: string; content: string; createdAt: number; updatedAt?: number }>();
  tracked = new Map<string, Tracked>();
  seq = 0;
  engine: SyncEngine;
  constructor(key: Uint8Array) {
    const chatStorage: Storage<WireChat> = {
      get: async id => (this.chats.has(id) ? toWireChat(this.chats.get(id)!) : undefined),
      put: async wire => void this.chats.set(wire.id, structuredClone(fromWireChat(wire, this.chats.get(wire.id)))),
      remove: async id => void this.chats.delete(id),
      all: async () => [...this.chats.values()].map(toWireChat),
    };
    const memoryStorage: Storage<WireMemory> = {
      get: async id => (this.memories.has(id) ? toWireMemory(this.memories.get(id)!) : undefined),
      put: async wire => void this.memories.set(wire.id, fromWireMemory(wire)),
      remove: async id => void this.memories.delete(id),
      all: async () => [...this.memories.values()].map(toWireMemory),
    };
    const stores: KindStore<any>[] = [chatKind(chatStorage), memoryKind(memoryStorage)]; // eslint-disable-line @typescript-eslint/no-explicit-any
    this.engine = new SyncEngine({ api, codec: mobileCodec(key), stores, tracking: memoryTracking(this), newId: () => randomUUID() });
  }
  async save(chat: PhoneConversation) {
    this.chats.set(chat.id, structuredClone(chat));
    await this.engine.markChanged('chat', chat.id, false);
  }
  async remove(id: string) {
    this.chats.delete(id);
    await this.engine.markChanged('chat', id, true);
  }
  async remember(id: string, content: string, at: number) {
    this.memories.set(id, { id, content, createdAt: 1000, updatedAt: at });
    await this.engine.markChanged('memory', id, false);
  }
}

let clock = 1_760_000_000_000;
const phoneStats = { promptTokens: 40, completionTokens: 25, totalTokens: 65, promptTime: 0.4, generationTime: 2.5, totalTime: 2.9, tokensPerSecond: 10, contextSize: 4096, contextUsed: 2 };
const phoneChat = (id: string, title: string): PhoneConversation => ({
  id, title, createdAt: ++clock, updatedAt: ++clock,
  messages: [
    { id: `${id}-u1`, role: 'user', content: 'What is in this photo? It is my 🚀 résumé.', timestamp: ++clock, image: { uri: 'file:///phone/photos/rocket.jpg', width: 800, height: 600, base64: 'PHONEPHOTOBYTES' } },
    { id: `${id}-a1`, role: 'assistant', content: '<think>The user shows a rocket.</think>\n\nA rocket on a launch pad.', timestamp: ++clock, stats: phoneStats, toolActions: [{ type: 'info_query', name: 'time', result: 'noon' }] },
  ],
});

describe('Quo Sync between the Android app and the web and desktop apps', () => {
  const recovery = phoneNewRecoveryKey(); // generated on the phone
  const phoneKey = phoneDeriveKey(recovery.secret);
  let webKey: CryptoKey;

  beforeAll(async () => {
    ({ handleApi } = await import('../server/routes.js'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    // A phone user signs in the way the app does: a bearer token, not a cookie.
    const start = await (await call('POST', 'auth/start', { email: 'both@example.com' })).json();
    const verify = await call('POST', 'auth/verify', { email: 'both@example.com', code: start.devCode });
    cookie = verify.headers.get('set-cookie')!.split(';')[0];
    const { url } = await (await call('POST', 'billing/checkout', { product: 'pro_yearly' })).json();
    await call('GET', url.replace('/api/', ''));
    // The phone turns sync on: its recovery key and verifier...
    await call('POST', 'sync/setup', { verifier: phoneMakeVerifier(phoneKey) });
    // ...and the web or desktop app joins by typing that key in.
    const secret = parseRecoveryKey(recovery.text.toLowerCase().replace(/-/g, ' '));
    expect(secret).not.toBeNull();
    webKey = await webDeriveKey(secret!);
  });

  it('agree on the recovery key and the verifier, in both directions', async () => {
    const status = await (await call('GET', 'sync/status')).json();
    expect(await webCodec(webKey).verify(status.verifier)).toBe(true); // web accepts the phone's verifier
    expect(phoneCheckVerifier(phoneKey, await webMakeVerifier(webKey))).toBe(true); // phone accepts the web's
  });

  it('carries a chat from the phone to the web, thinking and all, leaving the photo behind', async () => {
    const phone = new Phone(phoneKey);
    const web = new WebDevice(webKey);
    const chat = phoneChat('1760000000001-aaaaaaaaa', 'Rocket photo');
    await phone.save(chat);
    expect(await phone.engine.run()).toMatchObject({ pushed: 1 });
    expect(await web.engine.run()).toMatchObject({ pulled: 1, skipped: 0 });

    const arrived = web.chats.get(chat.id)!;
    expect(arrived.title).toBe('Rocket photo');
    expect(arrived.messages[0].content).toBe('What is in this photo? It is my 🚀 résumé.');
    expect(arrived.messages[1]).toMatchObject({ content: 'A rocket on a launch pad.', reasoning: 'The user shows a rocket.' });
    expect(arrived.messages[1].stats).toEqual({ tokens: 25, tokensPerSecond: 10, timeToFirstTokenMs: 400 });
    expect(arrived.messages[0].attachments).toEqual([{ id: `${chat.id}-u1:image`, kind: 'image', name: 'Photo', width: 800, height: 600, omitted: true }]);
    expect(JSON.stringify([...web.chats.values()])).not.toMatch(/PHONEPHOTOBYTES|file:\/\//);

    const db = await (await import('../server/db.js')).getDb();
    const rows = await db.query<{ blob: string }>('select blob from sync_records where id = $1', [chat.id]);
    expect(Buffer.from(rows[0].blob, 'base64').toString('latin1')).not.toMatch(/rocket|résumé|PHONEPHOTOBYTES/i);
  });

  it('carries a reply from the web back to the phone, which keeps its own photo, thinking and stats', async () => {
    const phone = new Phone(phoneKey);
    const web = new WebDevice(webKey);
    const chat = phoneChat('1760000000002-bbbbbbbbb', 'Round trip');
    await phone.save(chat);
    await phone.engine.run();
    await web.engine.run();

    const onWeb = structuredClone(web.chats.get(chat.id)!);
    onWeb.updatedAt = ++clock;
    onWeb.messages.push({ id: 'web-u2', role: 'user', content: 'Thanks! Now in French?', timestamp: ++clock }, { id: 'web-a2', role: 'assistant', content: 'Une fusée.', reasoning: 'Translate it.', modelName: 'Qwen3.5 4B', stats: { tokens: 5, tokensPerSecond: 80, timeToFirstTokenMs: 30 } });
    await web.save(onWeb);
    await web.engine.run();
    await phone.engine.run();

    const back = phone.chats.get(chat.id)!;
    expect(back.messages.map(m => m.id)).toEqual([`${chat.id}-u1`, `${chat.id}-a1`, 'web-u2', 'web-a2']);
    expect(back.messages[0].image).toEqual(chat.messages[0].image); // its own photo, untouched
    expect(back.messages[1]).toEqual(chat.messages[1]); // its own reply, exactly as it was (thinking inline, stats, tool actions)
    expect(back.messages[3].content).toBe('<think>Translate it.</think>\n\nUne fusée.'); // the web's reply, shown the phone's way
    expect(chatFingerprint(back)).not.toBe(chatFingerprint(chat));
  });

  it('keeps both sides when the phone and the web each add to the same chat at once', async () => {
    const phone = new Phone(phoneKey);
    const web = new WebDevice(webKey);
    const chat = phoneChat('1760000000003-ccccccccc', 'Both typing');
    await phone.save(chat);
    await phone.engine.run();
    await web.engine.run();

    const onPhone = structuredClone(phone.chats.get(chat.id)!);
    onPhone.updatedAt = ++clock;
    onPhone.messages.push({ id: 'phone-u2', role: 'user', content: 'phone says hi', timestamp: clock });
    const onWeb = structuredClone(web.chats.get(chat.id)!);
    onWeb.updatedAt = ++clock;
    onWeb.messages.push({ id: 'web-u2', role: 'user', content: 'web says hello' });
    await phone.save(onPhone);
    await web.save(onWeb);
    for (const device of [phone, web, phone, web]) await device.engine.run();

    const everything = (chats: Iterable<{ messages: { content: string }[] }>) => [...chats].flatMap(c => c.messages.map(m => m.content)).filter(t => /says/.test(t)).sort();
    expect(everything(phone.chats.values())).toEqual(['phone says hi', 'web says hello']);
    expect(everything(web.chats.values())).toEqual(['phone says hi', 'web says hello']);
    expect([...phone.chats.keys()].sort()).toEqual([...web.chats.keys()].sort());
    expect([...phone.chats.values()].map(c => c.title).filter(t => t.startsWith('Both typing')).sort()).toEqual(['Both typing', 'Both typing (other device)']);
  });

  it('deletes on one platform, deletes on the other', async () => {
    const phone = new Phone(phoneKey);
    const web = new WebDevice(webKey);
    const chat = phoneChat('1760000000004-ddddddddd', 'Short lived');
    await phone.save(chat);
    await phone.engine.run();
    await web.engine.run();
    expect(web.chats.has(chat.id)).toBe(true);
    await web.remove(chat.id);
    await web.engine.run();
    await phone.engine.run();
    expect(phone.chats.has(chat.id)).toBe(false);
  });

  it('keeps a phone’s memories between phones, invisible to and untouched by a web app that has none', async () => {
    const phoneA = new Phone(phoneKey);
    const phoneB = new Phone(phoneKey);
    const web = new WebDevice(webKey);
    await phoneA.remember('mem_1760000000010_aaaaaa', 'My name is Sam', 10);
    await phoneA.engine.run();
    const report = await web.engine.run();
    expect(report.skipped).toBe(0); // the web app never even receives them
    await web.save({ id: 'web-only-chat-1', title: 'From the web', createdAt: 1, updatedAt: 2, messages: [{ id: 'w1', role: 'user', content: 'hi' }] });
    await web.engine.run();
    await phoneB.engine.run();
    expect(phoneB.memories.get('mem_1760000000010_aaaaaa')?.content).toBe('My name is Sam');
    expect(phoneB.chats.get('web-only-chat-1')?.messages[0].content).toBe('hi');

    await phoneB.remember('mem_1760000000010_aaaaaa', 'My name is Samantha', 50);
    await phoneA.remember('mem_1760000000010_aaaaaa', 'My name is Sam J', 30); // earlier
    await phoneB.engine.run();
    await phoneA.engine.run();
    await phoneB.engine.run();
    expect(phoneA.memories.get('mem_1760000000010_aaaaaa')?.content).toBe('My name is Samantha');
    expect(phoneB.memories.get('mem_1760000000010_aaaaaa')?.content).toBe('My name is Samantha');
  });

  it('sign the phone in with a bearer token and no cookie', async () => {
    const start = await (await call('POST', 'auth/start', { email: 'both@example.com' })).json();
    const saved = cookie;
    cookie = '';
    const verify = await call('POST', 'auth/verify', { email: 'both@example.com', code: start.devCode, client: 'app' });
    const { token } = await verify.json();
    const me = await (await handleApi(new Request('http://localhost/api/me', { headers: { authorization: `Bearer ${token}` } }), 'me')).json();
    cookie = saved;
    expect(me).toMatchObject({ user: { email: 'both@example.com' }, sync: true });
  });
});
