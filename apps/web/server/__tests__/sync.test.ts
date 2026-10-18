// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.stubEnv('OPENROUTER_API_KEY', '');
vi.stubEnv('PADDLE_API_KEY', '');
vi.stubEnv('RESEND_API_KEY', '');

let handleApi: typeof import('../routes.js').handleApi;
let config: typeof import('../env.js').config;
let getDb: typeof import('../db.js').getDb;

beforeAll(async () => {
  ({ handleApi } = await import('../routes.js'));
  ({ config } = await import('../env.js'));
  ({ getDb } = await import('../db.js'));
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

interface Session {
  cookie: string;
}

function call(session: Session | null, method: string, path: string, body?: unknown) {
  return handleApi(new Request(`http://localhost/api/${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-quo-device': randomUUID(),
      'x-forwarded-for': '10.0.0.2',
      'sec-fetch-site': 'same-origin',
      ...(session ? { cookie: session.cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), path.split('?')[0]);
}

async function signIn(email: string): Promise<Session> {
  const start = await (await call(null, 'POST', 'auth/start', { email })).json();
  const verify = await call(null, 'POST', 'auth/verify', { email, code: start.devCode });
  return { cookie: verify.headers.get('set-cookie')!.split(';')[0] };
}

async function buy(session: Session, product: string) {
  const { url } = await (await call(session, 'POST', 'billing/checkout', { product })).json();
  await call(session, 'GET', url.replace('/api/', ''));
}

const blob = (text: string) => Buffer.from(text.padEnd(40, '.')).toString('base64');
const record = (id: string, text: string, baseSeq = 0) => ({ id, kind: 'chat', blob: blob(text), deleted: false, baseSeq });
const ids = () => [randomUUID(), randomUUID(), randomUUID()];

describe('Quo Sync API', () => {
  let alice: Session;
  let bob: Session;
  const [a, b, c] = ids();

  beforeAll(async () => {
    alice = await signIn('alice@example.com');
    bob = await signIn('bob@example.com');
  });

  it('needs a signed-in user', async () => {
    const response = await call(null, 'GET', 'sync/status');
    expect(response.status).toBe(401);
    expect((await response.json()).error).toBe('sign_in_required');
  });

  it('offers nothing until a plan that includes Quo Sync is bought', async () => {
    const status = await (await call(alice, 'GET', 'sync/status')).json();
    expect(status).toMatchObject({ entitled: false, enabled: false, verifier: null, records: 0 });
    const setup = await call(alice, 'POST', 'sync/setup', { verifier: blob('v') });
    expect(setup.status).toBe(402);
    expect((await setup.json()).error).toBe('sync_required');
    expect((await call(alice, 'POST', 'sync/push', { records: [record(a, 'x')] })).status).toBe(402);
    expect((await call(alice, 'GET', 'sync/pull')).status).toBe(404);
  });

  it('is included with the Sync plan, without giving Pro credits', async () => {
    const before = await (await call(alice, 'GET', 'me')).json();
    await buy(alice, 'sync_yearly');
    const me = await (await call(alice, 'GET', 'me')).json();
    expect(me).toMatchObject({ plan: 'free', sync: true });
    expect(me.credits).toBe(before.credits);
  });

  it('is included with Pro', async () => {
    await buy(bob, 'pro_monthly');
    expect(await (await call(bob, 'GET', 'me')).json()).toMatchObject({ plan: 'pro', sync: true });
  });

  it('sets up once, then tells other devices to use the recovery key', async () => {
    expect((await call(alice, 'POST', 'sync/setup', { verifier: 'not base64!' })).status).toBe(400);
    expect((await call(alice, 'POST', 'sync/setup', { verifier: blob('verifier') })).status).toBe(200);
    const again = await call(alice, 'POST', 'sync/setup', { verifier: blob('other') });
    expect(again.status).toBe(409);
    expect((await again.json()).error).toBe('already_set_up');
    const status = await (await call(alice, 'GET', 'sync/status')).json();
    expect(status).toMatchObject({ entitled: true, enabled: true, verifier: blob('verifier') });
  });

  it('stores records in order and serves them from a given point', async () => {
    const push = await (await call(alice, 'POST', 'sync/push', { records: [record(a, 'first'), record(b, 'second')] })).json();
    expect(push).toMatchObject({ seq: 2, accepted: [{ id: a, seq: 1 }, { id: b, seq: 2 }], conflicts: [] });

    const all = await (await call(alice, 'GET', 'sync/pull?since=0')).json();
    expect(all.records.map((r: { id: string }) => r.id)).toEqual([a, b]);
    expect(all.records[0]).toMatchObject({ kind: 'chat', blob: blob('first'), deleted: false, seq: 1 });
    expect(all.more).toBe(false);

    const later = await (await call(alice, 'GET', 'sync/pull?since=1')).json();
    expect(later.records.map((r: { id: string }) => r.id)).toEqual([b]);

    const paged = await (await call(alice, 'GET', 'sync/pull?since=0&limit=1')).json();
    expect(paged).toMatchObject({ more: true, seq: 1 });
    expect(paged.records).toHaveLength(1);
  });

  it('refuses to overwrite a newer version, and accepts the update once it was seen', async () => {
    const stale = await (await call(alice, 'POST', 'sync/push', { records: [record(a, 'edited on a phone', 0)] })).json();
    expect(stale).toMatchObject({ accepted: [], conflicts: [a] });
    const fresh = await (await call(alice, 'POST', 'sync/push', { records: [record(a, 'edited on a phone', 1)] })).json();
    expect(fresh).toMatchObject({ seq: 3, accepted: [{ id: a, seq: 3 }], conflicts: [] });
    const pulled = await (await call(alice, 'GET', 'sync/pull?since=2')).json();
    expect(pulled.records[0].blob).toBe(blob('edited on a phone'));
  });

  it('applies the good records of a batch even when one conflicts', async () => {
    const result = await (await call(alice, 'POST', 'sync/push', { records: [record(b, 'stale', 0), record(c, 'new one', 0)] })).json();
    expect(result.conflicts).toEqual([b]);
    expect(result.accepted).toEqual([{ id: c, seq: 4 }]);
  });

  it('keeps deletions as markers other devices will see', async () => {
    const before = await (await call(alice, 'GET', 'sync/status')).json();
    const deleted = await (await call(alice, 'POST', 'sync/push', { records: [{ id: c, kind: 'chat', blob: null, deleted: true, baseSeq: 4 }] })).json();
    expect(deleted.accepted).toEqual([{ id: c, seq: 5 }]);
    const pulled = await (await call(alice, 'GET', 'sync/pull?since=4')).json();
    expect(pulled.records[0]).toMatchObject({ id: c, deleted: true, blob: null });
    const after = await (await call(alice, 'GET', 'sync/status')).json();
    expect(after.usedBytes).toBeLessThan(before.usedBytes);
    expect(after.records).toBe(before.records - 1);
  });

  it('rejects malformed records', async () => {
    const bad = [
      { ...record(randomUUID(), 'x'), kind: 'secrets' },
      { ...record(randomUUID(), 'x'), id: '../../etc' },
      { ...record(randomUUID(), 'x'), blob: '<script>' },
      { ...record(randomUUID(), 'x'), blob: '' },
      { ...record(randomUUID(), 'x'), baseSeq: -1 },
      { ...record(randomUUID(), 'x'), baseSeq: 1.5 },
    ];
    for (const item of bad) expect((await call(alice, 'POST', 'sync/push', { records: [item] })).status).toBe(400);
    expect((await call(alice, 'POST', 'sync/push', { records: [] })).status).toBe(400);
    expect((await call(alice, 'POST', 'sync/push', { records: Array.from({ length: 26 }, () => record(randomUUID(), 'x')) })).status).toBe(400);
    const same = randomUUID();
    expect((await call(alice, 'POST', 'sync/push', { records: [record(same, 'x'), record(same, 'y')] })).status).toBe(400);
    const huge = await call(alice, 'POST', 'sync/push', { records: [{ ...record(randomUUID(), 'x'), blob: 'A'.repeat(1_400_004) }] });
    expect(huge.status).toBe(413);
    expect((await huge.json()).error).toBe('record_too_large');
  });

  it('stops at the storage limit, but still lets records shrink or be deleted', async () => {
    const { usedBytes } = await (await call(alice, 'GET', 'sync/status')).json();
    const saved = config.syncLimitBytes;
    config.syncLimitBytes = usedBytes + 100;
    try {
      const full = await call(alice, 'POST', 'sync/push', { records: [record(randomUUID(), 'x'.repeat(500))] });
      expect(full.status).toBe(413);
      expect((await full.json()).error).toBe('quota_exceeded');
      const pulled = await (await call(alice, 'GET', 'sync/pull?since=0&limit=1')).json();
      const shrink = await (await call(alice, 'POST', 'sync/push', { records: [record(pulled.records[0].id, 's', pulled.records[0].seq)] })).json();
      expect(shrink.accepted).toHaveLength(1);
    } finally {
      config.syncLimitBytes = saved;
    }
  });

  it('keeps each account’s data to itself', async () => {
    expect((await call(bob, 'GET', 'sync/pull')).status).toBe(404); // Bob hasn't set up
    await call(bob, 'POST', 'sync/setup', { verifier: blob('bobs') });
    const bobs = await (await call(bob, 'GET', 'sync/pull?since=0')).json();
    expect(bobs.records).toEqual([]);
    // Bob can't take over one of Alice's record ids to read or replace it.
    const clash = await (await call(bob, 'POST', 'sync/push', { records: [record(a, 'bob wrote this', 0)] })).json();
    expect(clash.accepted).toEqual([{ id: a, seq: 1 }]);
    const alices = await (await call(alice, 'GET', 'sync/pull?since=0&limit=100')).json();
    expect(alices.records.find((r: { id: string; blob: string }) => r.id === a).blob).toBe(blob('edited on a phone'));
  });

  it('lets people read their data after a plan ends, but not add to it', async () => {
    const db = await getDb();
    await db.query(`update subscriptions set status = 'canceled' where plan = 'sync_yearly'`);
    expect((await (await call(alice, 'GET', 'me')).json()).sync).toBe(false);
    expect((await call(alice, 'POST', 'sync/push', { records: [record(randomUUID(), 'x')] })).status).toBe(402);
    expect((await call(alice, 'GET', 'sync/pull?since=0')).status).toBe(200);
  });

  it('deletes everything on reset, even after a plan ends', async () => {
    expect((await call(alice, 'POST', 'sync/reset', {})).status).toBe(200);
    const status = await (await call(alice, 'GET', 'sync/status')).json();
    expect(status).toMatchObject({ enabled: false, verifier: null, records: 0, usedBytes: 0, seq: 0 });
    const db = await getDb();
    const [{ n }] = await db.query<{ n: number }>(`select count(*)::int as n from sync_records where id = $1`, [a]);
    expect(n).toBe(1); // Bob's record with the same id is untouched
  });

  it('blocks cross-site writes', async () => {
    const response = await handleApi(new Request('http://localhost/api/sync/reset', {
      method: 'POST',
      headers: { cookie: bob.cookie, 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' },
      body: '{}',
    }), 'sync/reset');
    expect(response.status).toBe(403);
  });
});

describe('Quo Sync when sign-in is not set up yet (production)', () => {
  beforeAll(() => {
    config.production = true;
    config.resendKey = null;
  });
  afterAll(() => {
    config.production = false;
  });

  it('answers every sync call with setup_required', async () => {
    for (const [method, path] of [['GET', 'sync/status'], ['POST', 'sync/setup'], ['GET', 'sync/pull'], ['POST', 'sync/push'], ['POST', 'sync/reset']] as const) {
      const response = await call(null, method, path, method === 'POST' ? {} : undefined);
      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body.error).toBe('setup_required');
      expect(body.message).toMatch(/Quo Sync/);
    }
  });
});
