'use strict';
// An ops reader that prints a secret is a leak with a cron job attached. These tests run it against a
// made-up database and read every line it prints.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const status = require('../../ops/auth/phone-code-status');

const TOKEN = 'fake-token-for-tests';
const PEPPER = 'test-pepper-0000000000000000000000000000';
const LIVE = { SMS_MODE: 'live', SMS_API_TOKEN: TOKEN, AUTH_PHONE_CODE_PEPPER: PEPPER };
function fakePrisma(over) {
  const o = over || {};
  return {
    seen: [],
    outboundMessage: { groupBy: async a => { o.seenGroupBy && o.seenGroupBy.push(a); return o.byStatus || []; } },
    authVerification: { count: async a => { o.seenCount && o.seenCount.push(a); return o.live == null ? 0 : o.live; } },
    authUser: { count: async a => { o.seenUsers && o.seenUsers.push(a); return o.accounts == null ? 0 : o.accounts; } }
  };
}
async function lines(env, over) {
  const out = [];
  const r = await status.run({ prisma: fakePrisma(over), env, out: m => out.push(m), now: () => new Date('2026-09-16T09:00:00Z') });
  return { out, r };
}

test('the door line says whether it is open and which switch is missing, and never a value', async () => {
  const { out } = await lines(LIVE);
  assert.match(out[0], /^phone sign-in · OPEN/);
  assert.match(out[0], /sms mode live/);
  assert.match(out[0], /provider token yes/);
  assert.match(out[0], /pepper yes/);
  assert.equal(out.join(' ').includes(TOKEN), false, 'the token is never printed');
  assert.equal(out.join(' ').includes(PEPPER), false, 'the pepper is never printed');
});

test('each missing switch is named, and a short pepper counts as missing', async () => {
  assert.match((await lines({ SMS_MODE: 'live', AUTH_PHONE_CODE_PEPPER: PEPPER })).out[0], /^phone sign-in · closed[\s\S]*provider token no/);
  assert.match((await lines({ SMS_API_TOKEN: TOKEN, SMS_MODE: 'test', AUTH_PHONE_CODE_PEPPER: PEPPER })).out[0], /^phone sign-in · closed[\s\S]*sms mode test/);
  assert.match((await lines({ SMS_API_TOKEN: TOKEN, SMS_MODE: 'live', AUTH_PHONE_CODE_PEPPER: 'short' })).out[0], /^phone sign-in · closed[\s\S]*pepper no/);
  assert.match((await lines({})).out[0], /^phone sign-in · closed/);
});

test('a month with no codes in it reads as a sentence, not as an empty list', async () => {
  const { out } = await lines(LIVE);
  assert.equal(out[1], 'codes this month · none');
  assert.equal(out[2], 'codes or locks in play right now · 0');
  assert.equal(out[3], 'accounts created by a phone code · 0');
});

test('it counts sign-in messages, live code rows and placeholder accounts, and nothing else', async () => {
  const seenGroupBy = [], seenCount = [], seenUsers = [];
  const { out, r } = await lines(LIVE, {
    seenGroupBy, seenCount, seenUsers,
    byStatus: [{ status: 'test', _count: 4 }, { status: 'sent', _count: 2 }, { status: 'failed', _count: 1 }],
    live: 3, accounts: 9
  });
  assert.equal(out[1], 'codes this month · test 4 · sent 2 · failed 1 · 7 in all');
  assert.equal(out[2], 'codes or locks in play right now · 3');
  assert.equal(out[3], 'accounts created by a phone code · 9');
  assert.equal(seenGroupBy[0].where.kind, 'signin');
  assert.deepEqual(seenGroupBy[0].by, ['status']);
  assert.equal(seenCount[0].where.identifier.startsWith, 'phonecode:');
  assert.equal(seenUsers[0].where.email.endsWith, '@phone.bina.et');
  assert.deepEqual(r, { ready: true, codes: 7, live: 3, accounts: 9 });
});

test('the dry run cannot send: it refuses outright when SMS is live, and never verifies or creates', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'ops', 'auth', 'phone-code-dryrun.js'), 'utf8');
  assert.match(src, /if \(String\(env\.SMS_MODE\) === 'live'\)/);
  assert.match(src, /return \{ ok: false, error: 'sms_live' \}/);
  assert.match(src, /const TEST_PHONE = '0900000001';/, 'a number that belongs to nobody');
  assert.match(src, /the dry run never verifies a code/);
  assert.match(src, /the dry run never creates an account/);
  assert.equal(/flow\.verify\(/.test(src), false, 'only send is ever run');
});
