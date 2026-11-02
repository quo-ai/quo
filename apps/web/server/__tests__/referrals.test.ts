// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { applyPaddleEvent } from '../billing.js';
import { getBalance, MILLI } from '../credits.js';
import { createTestDb, getDb, type Db } from '../db.js';
import { claimReferral, CODE_PATTERN, MAX_REWARDS, referralCode, rewardReferrer } from '../referrals.js';

// Sandbox: sign-in codes come back in the answer, purchases are simulated.
vi.stubEnv('OPENROUTER_API_KEY', '');
vi.stubEnv('PADDLE_API_KEY', '');
vi.stubEnv('RESEND_API_KEY', '');

const user = async (db: Db) => {
  const id = randomUUID();
  await db.query('insert into users (id, email) values ($1, $2)', [id, `${id}@example.com`]);
  return id;
};
const credits = async (db: Db, id: string) => (await getBalance(db, id)) / MILLI;

describe('invites, on their own', () => {
  it('a code is made once per person, and only a real new link gives the welcome credits', async () => {
    const db = await createTestDb();
    const [inviter, friend] = [await user(db), await user(db)];
    const code = await referralCode(db, inviter);
    expect(code).toMatch(CODE_PATTERN);
    expect(await referralCode(db, inviter)).toBe(code);
    expect(await claimReferral(db, inviter, code)).toBe(false); // yourself
    expect(await claimReferral(db, friend, 'zzzzzzzz')).toBe(false); // nobody's
    expect(await claimReferral(db, friend, '<script>')).toBe(false);
    expect(await claimReferral(db, friend, code)).toBe(true);
    expect(await claimReferral(db, friend, code)).toBe(false); // once
    expect(await credits(db, friend)).toBe(25);
  });

  it('the inviter is rewarded once, at the friend’s first payment, up to the cap; a refund of it takes the reward back', async () => {
    const db = await createTestDb();
    const inviter = await user(db);
    const code = await referralCode(db, inviter);
    const friend = await user(db);
    await claimReferral(db, friend, code);
    expect(await rewardReferrer(db, inviter, 'txn_own')).toBe(false); // the inviter's own purchase
    expect(await rewardReferrer(db, friend, 'txn_1')).toBe(true);
    expect(await rewardReferrer(db, friend, 'txn_2')).toBe(false); // a second payment
    expect(await credits(db, inviter)).toBe(50);
    await applyPaddleEvent(db, { event_id: randomUUID(), event_type: 'adjustment.updated', data: { id: 'adj_1', action: 'refund', status: 'approved', transaction_id: 'txn_1' } as never });
    expect(await credits(db, inviter)).toBe(0);

    for (let i = 0; i < MAX_REWARDS + 2; i++) {
      const another = await user(db);
      await claimReferral(db, another, code);
      await rewardReferrer(db, another, `txn_more_${i}`);
    }
    expect(await credits(db, inviter)).toBe(MAX_REWARDS * 50 - 50); // the first reward was refunded; the cap counts it
  });
});

describe('invites through the API', () => {
  let handleApi: typeof import('../routes.js').handleApi;
  beforeAll(async () => {
    ({ handleApi } = await import('../routes.js'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  const session = () => {
    let cookie = '';
    const device = randomUUID();
    const call = async (method: string, path: string, body?: unknown) => {
      const response = await handleApi(new Request(`http://localhost/api/${path}`, {
        method,
        headers: { 'content-type': 'application/json', 'x-quo-device': device, 'x-forwarded-for': '10.0.0.9', 'sec-fetch-site': 'same-origin', ...(cookie ? { cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      }), path);
      const set = response.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      return response;
    };
    const signIn = async (email: string, ref?: string) => {
      const { devCode } = await (await call('POST', 'auth/start', { email })).json();
      return (await call('POST', 'auth/verify', { email, code: devCode, ...(ref ? { ref } : {}) })).json();
    };
    return { call, signIn };
  };

  it('a new friend gets 25 more credits; signing in again, an old account or a returning address gets none; deleting removes the link', async () => {
    const ann = session();
    await ann.signIn('ann@example.com');
    const invite = await (await ann.call('GET', 'referral')).json();
    expect(invite).toMatchObject({ link: expect.stringContaining(`/?ref=${invite.code}`), rewarded: 0, max: MAX_REWARDS, forFriend: 25, forYou: 50 });

    const bob = session();
    expect((await bob.signIn('bob@example.com', invite.code)).credits).toBe(50); // trial 25 + 25
    expect((await bob.signIn('bob@example.com', invite.code)).credits).toBe(50); // again: nothing more

    const cara = session();
    await cara.signIn('cara@example.com');
    expect((await cara.signIn('cara@example.com', invite.code)).credits).toBe(25); // already had an account

    // Bob deletes his account and signs up again with the link: his address had the trial, so nothing.
    expect((await bob.call('POST', 'account/delete', { confirm: true })).status).toBe(200);
    expect((await session().signIn('bob@example.com', invite.code)).credits).toBe(0);

    expect((await ann.call('POST', 'account/delete', { confirm: true })).status).toBe(200);
    const db = await getDb();
    expect(await db.query('select 1 from referral_codes where code = $1', [invite.code])).toHaveLength(0);
    expect(await db.query(`select 1 from referrals r join users u on u.id = r.referrer_user_id where u.email = 'ann@example.com'`)).toHaveLength(0);
  });

  it('asks for sign-in', async () => {
    expect((await session().call('GET', 'referral')).status).toBe(401);
  });
});
