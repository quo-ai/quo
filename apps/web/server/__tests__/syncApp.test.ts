// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';

vi.stubEnv('OPENROUTER_API_KEY', '');
vi.stubEnv('PADDLE_API_KEY', '');
vi.stubEnv('RESEND_API_KEY', '');

let handleApi: typeof import('../routes.js').handleApi;
let config: typeof import('../env.js').config;
let getDb: typeof import('../db.js').getDb;
let cleanupSync: typeof import('../syncRetention.js').cleanupSync;
let takeSyncCall: typeof import('../sync.js').takeSyncCall;
let log: MockInstance<typeof console.log>;

beforeAll(async () => {
  ({ handleApi } = await import('../routes.js'));
  ({ config } = await import('../env.js'));
  ({ getDb } = await import('../db.js'));
  ({ cleanupSync } = await import('../syncRetention.js'));
  ({ takeSyncCall } = await import('../sync.js'));
  log = vi.spyOn(console, 'log').mockImplementation(() => {});
});

type Auth = { cookie?: string; token?: string };

function call(auth: Auth | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  return handleApi(new Request(`http://localhost/api/${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-quo-device': randomUUID(),
      'x-forwarded-for': '10.0.0.4',
      ...(auth?.cookie ? { cookie: auth.cookie, 'sec-fetch-site': 'same-origin' } : {}),
      ...(auth?.token ? { authorization: `Bearer ${auth.token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), path.split('?')[0]);
}

async function startSignIn(email: string): Promise<string> {
  return (await (await call(null, 'POST', 'auth/start', { email })).json()).devCode;
}

// "Sign out everywhere" ends sessions issued before it; a moment apart keeps "before" clear when the database answers within a millisecond.
const tick = () => new Promise(resolve => setTimeout(resolve, 3));

async function signInWithApp(email: string): Promise<Auth> {
  const verify = await call(null, 'POST', 'auth/verify', { email, code: await startSignIn(email), client: 'app' });
  await tick();
  return { token: (await verify.json()).token };
}

async function signInWithCookie(email: string): Promise<Auth> {
  const verify = await call(null, 'POST', 'auth/verify', { email, code: await startSignIn(email) });
  await tick();
  return { cookie: verify.headers.get('set-cookie')!.split(';')[0] };
}

async function buy(auth: Auth, product: string) {
  const { url } = await (await call(auth, 'POST', 'billing/checkout', { product })).json();
  await call(auth, 'GET', url.replace('/api/', ''));
}

const blob = (text: string) => Buffer.from(text.padEnd(40, '.')).toString('base64');

describe('the phone app’s bearer token', () => {
  it('is returned to the app, never as a cookie, and the web keeps its cookie and gets no token', async () => {
    const email = 'bearer@example.com';
    const app = await call(null, 'POST', 'auth/verify', { email, code: await startSignIn(email), client: 'app' });
    expect(app.status).toBe(200);
    expect(app.headers.get('set-cookie')).toBeNull();
    const body = await app.json();
    expect(body.token).toMatch(/^[\w-]+\.[\w-]+$/);
    expect(body.user.email).toBe(email);

    const web = await call(null, 'POST', 'auth/verify', { email, code: await startSignIn(email) });
    expect(web.headers.get('set-cookie')).toContain('HttpOnly');
    expect((await web.json()).token).toBeUndefined();
  });

  it('signs the app in without a cookie, on every call', async () => {
    const auth = await signInWithApp('bearer2@example.com');
    expect((await (await call(auth, 'GET', 'me')).json()).user.email).toBe('bearer2@example.com');
    expect((await call(auth, 'GET', 'sync/status')).status).toBe(200);
  });

  it('rejects a forged, damaged or empty token', async () => {
    const { token } = await signInWithApp('bearer3@example.com');
    const [payload, signature] = token!.split('.');
    for (const bad of [`${payload}.${signature.slice(0, -2)}xx`, `${payload}x.${signature}`, 'nonsense', payload]) {
      expect((await (await call({ token: bad }, 'GET', 'me')).json()).user).toBeNull();
      expect((await call({ token: bad }, 'GET', 'sync/status')).status).toBe(401);
    }
    expect((await call({ token: '' }, 'GET', 'sync/status')).status).toBe(401);
  });
});

describe('Quo Sync record kinds', () => {
  let auth: Auth;
  const chatId = randomUUID();
  const memoryId = 'memory:mem_1760000000000_ab12cd';

  beforeAll(async () => {
    auth = await signInWithApp('kinds@example.com');
    await buy(auth, 'sync_yearly');
    await call(auth, 'POST', 'sync/setup', { verifier: blob('v') });
  });

  it('stores memories next to chats, and accepts the phone app’s underscored ids', async () => {
    const push = await (await call(auth, 'POST', 'sync/push', { records: [
      { id: chatId, kind: 'chat', blob: blob('a chat'), deleted: false, baseSeq: 0 },
      { id: memoryId, kind: 'memory', blob: blob('a memory'), deleted: false, baseSeq: 0 },
    ] })).json();
    expect(push.accepted).toHaveLength(2);
  });

  it('gives older clients chats only, and newer ones the kinds they ask for', async () => {
    const ids = async (query: string) => (await (await call(auth, 'GET', `sync/pull?since=0${query}`)).json()).records.map((r: { id: string }) => r.id);
    expect(await ids('')).toEqual([chatId]);
    expect(await ids('&kinds=chat')).toEqual([chatId]);
    expect(await ids('&kinds=chat,memory')).toEqual([chatId, memoryId]);
    expect(await ids('&kinds=memory')).toEqual([memoryId]);
    expect(await ids('&kinds=nonsense')).toEqual([chatId]);
  });

  it('still rejects unknown kinds and unsafe ids', async () => {
    const bad = [
      { id: randomUUID(), kind: 'settings', blob: blob('x'), deleted: false, baseSeq: 0 },
      { id: 'a/b/c/d/e/f/g/h', kind: 'chat', blob: blob('x'), deleted: false, baseSeq: 0 },
      { id: 'short', kind: 'chat', blob: blob('x'), deleted: false, baseSeq: 0 },
      { id: `${randomUUID()}'; drop table users; --`, kind: 'chat', blob: blob('x'), deleted: false, baseSeq: 0 },
    ];
    for (const record of bad) expect((await call(auth, 'POST', 'sync/push', { records: [record] })).status).toBe(400);
  });
});

describe('Quo Sync retention', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const email = 'retention@example.com';
  let auth: Auth;
  let userId: string;

  async function accountExists() {
    const db = await getDb();
    const [{ n }] = await db.query<{ n: number }>('select count(*)::int as n from sync_accounts where user_id = $1', [userId]);
    return n === 1;
  }
  async function recordCount() {
    const db = await getDb();
    const [{ n }] = await db.query<{ n: number }>('select count(*)::int as n from sync_records where user_id = $1', [userId]);
    return n;
  }

  beforeAll(async () => {
    auth = await signInWithApp(email);
    await buy(auth, 'sync_yearly');
    await call(auth, 'POST', 'sync/setup', { verifier: blob('v') });
    await call(auth, 'POST', 'sync/push', { records: [{ id: randomUUID(), kind: 'chat', blob: blob('chat'), deleted: false, baseSeq: 0 }] });
    const db = await getDb();
    [{ id: userId }] = await db.query<{ id: string }>('select id from users where email = $1', [email]);
  });

  it('leaves accounts with a plan alone', async () => {
    const db = await getDb();
    const far = new Date(Date.now() + 400 * DAY);
    expect(await cleanupSync(db, far)).toMatchObject({ deletedAccounts: 0, warned: 0 });
    expect(await accountExists()).toBe(true);
  });

  describe('after the plan ends', () => {
    const ended = new Date('2026-01-01T00:00:00Z');
    const at = (days: number) => new Date(ended.getTime() + days * DAY);

    beforeAll(async () => {
      const db = await getDb();
      await db.query(`update subscriptions set status = 'canceled', current_period_end = $2 where user_id = $1`, [userId, ended]);
    });

    it('keeps everything for the first months, without warning', async () => {
      const db = await getDb();
      log.mockClear();
      expect(await cleanupSync(db, at(1))).toMatchObject({ deletedAccounts: 0, warned: 0 });
      expect(await cleanupSync(db, at(149))).toMatchObject({ deletedAccounts: 0, warned: 0 });
      expect(await accountExists()).toBe(true);
      expect(log.mock.calls.some((args: unknown[]) => String(args[0]).includes('retention notice'))).toBe(false);
    });

    it('warns once, 30 days before deleting', async () => {
      const db = await getDb();
      log.mockClear();
      expect(await cleanupSync(db, at(151))).toMatchObject({ deletedAccounts: 0, warned: 1 });
      const notice = log.mock.calls.map((args: unknown[]) => String(args[0])).find((line: string) => line.includes('retention notice'));
      expect(notice).toContain(email);
      expect(notice).toContain('June 2026'); // 1 Jan + 180 days
      expect(await cleanupSync(db, at(160))).toMatchObject({ warned: 0 }); // not again
      expect(await accountExists()).toBe(true);
    });

    it('lets people get their data out until then', async () => {
      expect((await call(auth, 'GET', 'sync/pull?since=0')).status).toBe(200);
      expect(await recordCount()).toBe(1);
    });

    it('starts over, with no warning, when they subscribe again', async () => {
      const db = await getDb();
      await buy(auth, 'sync_yearly');
      expect(await cleanupSync(db, at(170))).toMatchObject({ deletedAccounts: 0, warned: 0 });
      const [{ warned_at }] = await db.query<{ warned_at: Date | null }>('select warned_at from sync_accounts where user_id = $1', [userId]);
      expect(warned_at).toBeNull();
      await db.query(`update subscriptions set status = 'canceled', current_period_end = $2 where user_id = $1`, [userId, ended]);
    });

    it('deletes the encrypted copy after 180 days', async () => {
      const db = await getDb();
      expect(await cleanupSync(db, at(181))).toMatchObject({ deletedAccounts: 1 });
      expect(await accountExists()).toBe(false);
      expect(await recordCount()).toBe(0);
    });

    it('can warn again later if they come back and lapse again', async () => {
      const db = await getDb();
      await buy(auth, 'sync_yearly');
      await call(auth, 'POST', 'sync/setup', { verifier: blob('v2') });
      await db.query(`update subscriptions set status = 'canceled', current_period_end = $2 where user_id = $1`, [userId, ended]);
      expect(await cleanupSync(db, at(151))).toMatchObject({ warned: 1 });
    });
  });

  it('prunes old deletion markers but not recent ones or live chats', async () => {
    const db = await getDb();
    const [{ id: other }] = await db.query<{ id: string }>('select id from users where email = $1', ['kinds@example.com']);
    const old = new Date(Date.now() - 100 * DAY);
    await db.query(
      `insert into sync_records (user_id, id, kind, seq, blob, deleted, size, updated_at) values
         ($1, 'old-marker-aaaa', 'chat', 100, null, true, 0, $2),
         ($1, 'new-marker-aaaa', 'chat', 101, null, true, 0, now()),
         ($1, 'old-live-chatx', 'chat', 102, 'AAAA', false, 4, $2)`,
      [other, old],
    );
    const result = await cleanupSync(db);
    expect(result.prunedMarkers).toBe(1);
    const left = (await db.query<{ id: string }>(`select id from sync_records where user_id = $1 and id like '%-marker-aaaa' or id = 'old-live-chatx'`, [other])).map(r => r.id).sort();
    expect(left).toEqual(['new-marker-aaaa', 'old-live-chatx']);
  });
});

describe('the clean-up schedule endpoint', () => {
  afterAll(() => {
    config.cronSecret = null;
  });

  it('does not exist until a secret is set', async () => {
    config.cronSecret = null;
    expect((await call(null, 'GET', 'cron/sync-cleanup')).status).toBe(404);
  });

  it('runs only for the scheduler that knows the secret', async () => {
    config.cronSecret = 'cron-secret-for-tests';
    expect((await call(null, 'GET', 'cron/sync-cleanup')).status).toBe(401);
    expect((await call({ token: 'cron-secret-for-tests-but-wrong' }, 'GET', 'cron/sync-cleanup')).status).toBe(401);
    const ok = await call({ token: 'cron-secret-for-tests' }, 'GET', 'cron/sync-cleanup');
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ deletedAccounts: expect.any(Number), warned: expect.any(Number), prunedMarkers: expect.any(Number) });
  });
});

describe('deleting an account', () => {
  const email = 'delete-me@example.com';
  let auth: Auth;
  let userId: string;

  async function count(table: string): Promise<number> {
    const db = await getDb();
    const [{ n }] = await db.query<{ n: number }>(`select count(*)::int as n from ${table} where user_id = $1`, [userId]);
    return n;
  }

  beforeAll(async () => {
    auth = await signInWithApp(email);
    const db = await getDb();
    [{ id: userId }] = await db.query<{ id: string }>('select id from users where email = $1', [email]);
    await buy(auth, 'pro_monthly');
    await call(auth, 'POST', 'sync/setup', { verifier: blob('v') });
    await call(auth, 'POST', 'sync/push', { records: [
      { id: randomUUID(), kind: 'chat', blob: blob('a chat'), deleted: false, baseSeq: 0 },
      { id: 'memory:mem_1760000000000_zzzzzz', kind: 'memory', blob: blob('a memory'), deleted: false, baseSeq: 0 },
    ] });
  });

  it('needs someone signed in, and a clear confirmation', async () => {
    expect((await call(null, 'POST', 'account/delete', { confirm: true })).status).toBe(401);
    expect((await call(auth, 'POST', 'account/delete', {})).status).toBe(400);
    expect((await call(auth, 'POST', 'account/delete', { confirm: 'yes' })).status).toBe(400);
    expect(await count('sync_records')).toBe(2);
  });

  it('refuses while a plan is still running, and says what to do', async () => {
    const refused = await call(auth, 'POST', 'account/delete', { confirm: true });
    expect(refused.status).toBe(409);
    const body = await refused.json();
    expect(body.error).toBe('plan_active');
    expect(body.message).toMatch(/cancel your plan/i);
    expect(await count('sync_records')).toBe(2);
  });

  it('removes the account and everything held for it once the plan has ended', async () => {
    const db = await getDb();
    await db.query(`update subscriptions set status = 'canceled' where user_id = $1`, [userId]);
    const response = await call(auth, 'POST', 'account/delete', { confirm: true });
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    for (const table of ['sync_records', 'sync_accounts', 'credit_grants', 'credit_ledger', 'credit_holds', 'subscriptions']) {
      expect(await count(table), table).toBe(0);
    }
    expect(await db.query('select 1 from users where email = $1', [email])).toHaveLength(0);
    expect(await db.query('select 1 from login_codes where email = $1', [email])).toHaveLength(0);
  });

  it('leaves the old sign-in token useless', async () => {
    expect((await (await call(auth, 'GET', 'me')).json()).user).toBeNull();
    for (const [method, path] of [['GET', 'sync/status'], ['POST', 'sync/setup'], ['GET', 'sync/pull'], ['POST', 'sync/push'], ['POST', 'sync/reset']] as const) {
      const response = await call(auth, method, path, method === 'POST' ? { verifier: blob('v'), records: [] } : undefined);
      expect(response.status, path).toBe(401);
    }
  });

  it('does not touch anyone else’s data', async () => {
    const other = await signInWithApp('keeps-everything@example.com');
    await buy(other, 'sync_yearly');
    await call(other, 'POST', 'sync/setup', { verifier: blob('v') });
    const mine = await signInWithApp('goes-away@example.com');
    expect((await call(mine, 'POST', 'account/delete', { confirm: true })).status).toBe(200);
    expect((await (await call(other, 'GET', 'sync/status')).json())).toMatchObject({ enabled: true, entitled: true });
  });

  it('can be done again by signing in afresh, which starts a new, empty account', async () => {
    const again = await signInWithApp(email);
    expect((await (await call(again, 'GET', 'me')).json())).toMatchObject({ user: { email }, plan: 'free', sync: false });
    expect((await (await call(again, 'GET', 'sync/status')).json())).toMatchObject({ enabled: false, records: 0 });
  });

  it('answers setup_required where sign-in is not set up', async () => {
    config.production = true;
    config.resendKey = null;
    try {
      const response = await call(null, 'POST', 'account/delete', { confirm: true });
      expect(response.status).toBe(503);
      expect((await response.json()).error).toBe('setup_required');
    } finally {
      config.production = false;
    }
  });
});

describe('signing out everywhere', () => {
  const email = 'lost-phone@example.com';
  const meEmail = async (auth: Auth) => (await (await call(auth, 'GET', 'me')).json()).user?.email ?? null;

  it('ends every other session, whether web or phone, and keeps the one that asked', async () => {
    const web = await signInWithCookie(email);
    const laptop = await signInWithCookie(email);
    const phone = await signInWithApp(email);
    for (const auth of [web, laptop, phone]) expect(await meEmail(auth)).toBe(email);

    const response = await call(web, 'POST', 'auth/signout-all', {});
    expect(response.status).toBe(200);
    const stillWeb: Auth = { cookie: response.headers.get('set-cookie')!.split(';')[0] };

    expect(await meEmail(web)).toBeNull(); // the old cookie, even the one that asked
    expect(await meEmail(laptop)).toBeNull();
    expect(await meEmail(phone)).toBeNull();
    expect(await meEmail(stillWeb)).toBe(email); // but the browser carries on, with a fresh session
  });

  it('turns a revoked phone away from everything that needs an account', async () => {
    const phone = await signInWithApp('revoked-phone@example.com');
    await buy(phone, 'sync_yearly');
    await call(phone, 'POST', 'sync/setup', { verifier: blob('v') });
    const web = await signInWithCookie('revoked-phone@example.com');
    expect((await call(web, 'POST', 'auth/signout-all', {})).status).toBe(200);
    expect((await call(phone, 'GET', 'sync/status')).status).toBe(401);
    expect((await call(phone, 'GET', 'sync/pull?since=0')).status).toBe(401);
    expect((await call(phone, 'POST', 'sync/push', { records: [] })).status).toBe(401);
    expect((await call(phone, 'POST', 'billing/checkout', { product: 'pro_monthly' })).status).toBe(401);
    expect((await call(phone, 'POST', 'account/delete', { confirm: true })).status).toBe(401);
  });

  it('gives the phone a fresh token when the phone is the one that asks', async () => {
    const old = await signInWithApp('phone-asks@example.com');
    const response = await call(old, 'POST', 'auth/signout-all', { client: 'app' });
    expect(response.headers.get('set-cookie')).toBeNull();
    const fresh: Auth = { token: (await response.json()).token };
    expect(await meEmail(old)).toBeNull();
    expect(await meEmail(fresh)).toBe('phone-asks@example.com');
  });

  it('lets people sign in again afterwards, and revoke again later', async () => {
    const first = await signInWithApp('again@example.com');
    await call(first, 'POST', 'auth/signout-all', {});
    const second = await signInWithApp('again@example.com');
    expect(await meEmail(second)).toBe('again@example.com');
    await call(second, 'POST', 'auth/signout-all', {});
    expect(await meEmail(second)).toBeNull();
  });

  it('is for signed-in people only, and only touches their own account', async () => {
    expect((await call(null, 'POST', 'auth/signout-all', {})).status).toBe(401);
    expect((await call({ token: 'nonsense' }, 'POST', 'auth/signout-all', {})).status).toBe(401);
    const mine = await signInWithApp('revoker@example.com');
    const theirs = await signInWithApp('bystander@example.com');
    await call(mine, 'POST', 'auth/signout-all', {});
    expect(await meEmail(theirs)).toBe('bystander@example.com');
  });

  it('cannot be triggered from another website', async () => {
    const web = await signInWithCookie('csrf@example.com');
    const forged = await call(web, 'POST', 'auth/signout-all', {}, { 'sec-fetch-site': 'cross-site' });
    expect(forged.status).toBe(403);
    expect(await meEmail(web)).toBe('csrf@example.com');
  });

  it('also stops the tokens of a deleted account working anywhere', async () => {
    const auth = await signInWithApp('deleted-token@example.com');
    expect((await call(auth, 'POST', 'account/delete', { confirm: true })).status).toBe(200);
    expect((await call(auth, 'POST', 'billing/checkout', { product: 'sync_yearly' })).status).toBe(401);
    expect(await meEmail(auth)).toBeNull();
  });
});

describe('the Quo Sync call limit', () => {
  it('lets a working app through and stops one stuck in a loop, then lets it back in', () => {
    const user = 'limit-user';
    const start = 1_000_000;
    for (let i = 0; i < 600; i++) expect(takeSyncCall(user, start + i)).toBe(true);
    expect(takeSyncCall(user, start + 700)).toBe(false);
    expect(takeSyncCall(user, start + 30_000)).toBe(false);
    expect(takeSyncCall(user, start + 61_000)).toBe(true); // a new minute
    expect(takeSyncCall('someone-else', start + 700)).toBe(true); // others are unaffected
  });

  it('answers 429 with when to come back, and never for anything else', async () => {
    const auth = await signInWithApp('looping@example.com');
    const db = await getDb();
    const [{ id }] = await db.query<{ id: string }>('select id from users where email = $1', ['looping@example.com']);
    expect((await call(auth, 'GET', 'sync/status')).status).toBe(200);
    for (let i = 0; i < 700; i++) takeSyncCall(id);
    const limited = await call(auth, 'GET', 'sync/status');
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
    expect((await limited.json()).error).toBe('slow_down');
    expect((await call(auth, 'GET', 'me')).status).toBe(200); // the rest of the API isn't affected
  });
});
