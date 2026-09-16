'use strict';
// The glue. auth.mjs cannot be imported in a test — it opens a Prisma client and reads the
// environment — so its wiring is pinned by reading it, the way test/messaging/server-delivery.test.js
// pins server.js. The plugin itself IS imported: it is pure glue and importing it proves the two
// endpoints exist at the addresses the login page posts to.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

test('the plugin offers exactly two POST endpoints, at the addresses the login page posts to', async () => {
  const { phoneCode } = await import('../../auth/phone-code-plugin.mjs');
  const p = phoneCode({ pepper: 'test-pepper-0000000000000000000000000000', sender: { configured: false, supports: () => true, send: async () => ({ ok: true }) } });
  assert.equal(p.id, 'phone-code');
  const names = Object.keys(p.endpoints).sort();
  assert.deepEqual(names, ['sendPhoneCode', 'verifyPhoneCode']);
  assert.equal(p.endpoints.sendPhoneCode.path, '/sign-in/phone-code/send');
  assert.equal(p.endpoints.verifyPhoneCode.path, '/sign-in/phone-code/verify');
  assert.equal(p.endpoints.sendPhoneCode.options.method, 'POST');
  assert.equal(p.endpoints.verifyPhoneCode.options.method, 'POST', 'a code must never be able to travel in a URL');
});

test('the plugin keeps one flow, so the limiters are a rate limit and not a decoration', () => {
  const src = read('auth/phone-code-plugin.mjs');
  assert.match(src, /let flow = null;/);
  assert.match(src, /if \(flow\) return flow;/);
  assert.match(src, /makePhoneCodeFlow\(\{/);
  // The address comes from the header nginx sets, not from the socket, which is 127.0.0.1 for everyone.
  assert.match(src, /x-real-ip/);
  assert.match(src, /identity\.setVerifiedPhone\(userId, phone, 'sms'\)/);
});

test('every refusal from the flow has one status, and the wrong-code sentence is one sentence', () => {
  const src = read('auth/phone-code-plugin.mjs');
  assert.match(src, /'not_configured'.*SERVICE_UNAVAILABLE|SERVICE_UNAVAILABLE[\s\S]{0,120}not configured/);
  assert.match(src, /new APIError\('BAD_REQUEST', \{ message: 'not_reachable' \}\)/);
  assert.match(src, /new APIError\('TOO_MANY_REQUESTS', \{ message: 'rate_limited' \}\)/);
  // One message object for both ways verify can fail, so the two are not distinguishable.
  assert.equal((src.match(/message: NO/g) || []).length, 2);
  assert.match(src, /const NO = /);
  // What comes back is masked; the full number is never echoed by the server.
  assert.match(src, /phone: pc\.maskPhone\(normPhone\(ctx\.body\.phone\)\)/);
});

test('auth.mjs adds the phone door beside Telegram, with the sender and the pepper from the environment', () => {
  const src = read('auth.mjs');
  assert.match(src, /import \{ phoneCode \} from '\.\/auth\/phone-code-plugin\.mjs';/);
  assert.match(src, /const \{ makePhoneCodeSender \} = require\('\.\/auth\/phone-code-sender\.js'\);/);
  assert.match(src, /phoneCode\(\{/);
  assert.match(src, /sender: makePhoneCodeSender\(\{ prisma, env: process\.env/);
  assert.match(src, /pepper: process\.env\.AUTH_PHONE_CODE_PEPPER/);
  assert.match(src, /telegram\(\{ botToken: process\.env\.BINA_RIDER_BOT_TOKEN \}\)/, 'the Telegram door is untouched');
  // The pepper is read, never printed.
  assert.equal(/console\.log\([^)]*PEPPER/.test(src), false);
});

test('a phone-only account has no e-mail address as far as the site is concerned', async () => {
  const { makeIdentity } = require('../../auth/identity');
  const row = {
    id: 'u1', name: '+251 ••• 0001', email: 'p251900000001@phone.bina.et', image: null, role: 'user',
    phone: '+251900000001', phoneVerifiedAt: new Date(), telegramId: null, buildingSlug: null,
    rider: null, driver: null, memberships: [], accounts: []
  };
  const identity = makeIdentity({ prisma: { authUser: { findUnique: async () => row } } });
  const me = await identity.me('u1');
  assert.equal(me.email, null, 'a placeholder is not an address');
  assert.equal(me.phone, '+251900000001');
  assert.equal(me.phoneVerified, true);
  assert.deepEqual(me.roles, ['user']);
});

test('a real address is still shown, and the Telegram placeholder is still hidden', async () => {
  const { makeIdentity } = require('../../auth/identity');
  const base = { id: 'u1', name: 'Demo', image: null, role: 'user', phone: null, phoneVerifiedAt: null,
    telegramId: null, buildingSlug: null, rider: null, driver: null, memberships: [], accounts: [] };
  const of = async email => (await makeIdentity({ prisma: { authUser: { findUnique: async () => Object.assign({}, base, { email }) } } }).me('u1')).email;
  assert.equal(await of('owner@example.com'), 'owner@example.com');
  assert.equal(await of('tg123@telegram.bina.et'), null);
  assert.equal(await of('p251900000001@phone.bina.et'), null);
});

const NO_SENTENCE = 'That code is wrong or has expired';

// ---- carry-overs the plan pins by reading the file; these drive the two endpoints instead -------
// better-auth endpoints are plain functions: give one a body, headers and the auth context and it
// runs, which is enough to prove the limiters outlive a request and that an unconfigured door is shut.

const PEPPER = 'test-pepper-0000000000000000000000000000';
const FAKE = '0900000001', FAKE_E164 = '+251900000001';

function harness(over) {
  const calls = { sent: [], findUser: 0, created: [], removed: 0, sessions: 0 };
  const sender = Object.assign({
    configured: true,
    supports: () => true,
    send: async ({ phone }) => { calls.sent.push(phone); return { ok: true, status: 'sent' }; }
  }, (over && over.sender) || {});
  const { phoneCode } = harness.mod;
  const plugin = phoneCode(Object.assign({
    pepper: PEPPER, sender,
    identity: { setVerifiedPhone: async () => ({ ok: true }) },
    log: (over && over.log) || (() => {})
  }, (over && over.plugin) || {}));
  const context = {
    internalAdapter: {
      findVerificationValue: async () => null,
      createVerificationValue: async v => { calls.created.push(v); return v; },
      deleteVerificationByIdentifier: async () => { calls.removed++; return null; },
      createUser: async u => ({ id: 'u1', ...u }),
      createSession: async () => { calls.sessions++; return { id: 's1' }; }
    },
    adapter: { findOne: async () => { calls.findUser++; return null; } }
  };
  const hit = async (name, body, ip) => {
    try {
      return { status: 200, body: await plugin.endpoints[name]({ body, headers: new Headers({ 'x-real-ip': ip || '10.0.0.1' }), context }) };
    } catch (e) { return { status: e.status || e.statusCode || 'err', message: String(e.message || e) }; }
  };
  return { calls, hit, plugin };
}

test('the flow outlives the request: a fourth code for one number is refused, and the send door never asks who owns it', async () => {
  harness.mod = await import('../../auth/phone-code-plugin.mjs');
  const h = harness();
  const out = [];
  for (let i = 0; i < 4; i++) out.push(await h.hit('sendPhoneCode', { phone: FAKE }));
  assert.deepEqual(out.slice(0, 3).map(r => r.status), [200, 200, 200]);
  assert.deepEqual(out.slice(0, 3).map(r => r.body), [{ ok: true }, { ok: true }, { ok: true }]);
  // A flow rebuilt per request would have a fresh limiter and this would be a fourth code.
  assert.equal(out[3].status, 'TOO_MANY_REQUESTS');
  assert.equal(h.calls.sent.length, 3, 'three codes, not four');
  // Nothing in the send path looks an account up, so a number with one and a number without get
  // byte-identical answers by construction, not by remembering to make them match.
  assert.equal(h.calls.findUser, 0);
});

test('the verify door is limited per address as well as per number', async () => {
  harness.mod = await import('../../auth/phone-code-plugin.mjs');
  const h = harness();
  const bad = { phone: FAKE, code: '000000' };
  let last = null;
  for (let i = 0; i < 30; i++) last = await h.hit('verifyPhoneCode', bad, '10.0.0.2');
  assert.equal(last.status, 'UNAUTHORIZED', 'thirty guesses are still answered the same way');
  const over = await h.hit('verifyPhoneCode', bad, '10.0.0.2');
  assert.equal(over.status, 'TOO_MANY_REQUESTS');
  // One address running out does not shut the door on anybody else.
  const other = await h.hit('verifyPhoneCode', bad, '10.0.0.3');
  assert.equal(other.status, 'UNAUTHORIZED');
  assert.equal(h.calls.sessions, 0, 'no session is ever created by a wrong code');
});

test('with the sender not configured, both doors refuse and nothing is written', async () => {
  harness.mod = await import('../../auth/phone-code-plugin.mjs');
  const h = harness({ sender: { configured: false } });     // SMS_MODE=test today: this is the live shape
  const s = await h.hit('sendPhoneCode', { phone: FAKE });
  assert.equal(s.status, 'SERVICE_UNAVAILABLE');
  const v = await h.hit('verifyPhoneCode', { phone: FAKE, code: '123456' });
  // Verify has one answer for every failure, so an unconfigured door is not distinguishable from a
  // wrong code — that is the design, not an oversight.
  assert.equal(v.status, 'UNAUTHORIZED');
  assert.equal(v.message, NO_SENTENCE);
  assert.equal(h.calls.sent.length, 0);
  assert.equal(h.calls.created.length, 0, 'no verification row');
  assert.equal(h.calls.findUser, 0, 'no account lookup');
  assert.equal(h.calls.sessions, 0);
});

test('a refused send is logged as a kind, and the caller is told nothing either way', async () => {
  harness.mod = await import('../../auth/phone-code-plugin.mjs');
  const lines = [];
  const h = harness({ sender: { send: async () => ({ ok: false, errorKind: 'provider_error' }) }, log: m => lines.push(String(m)) });
  const r = await h.hit('sendPhoneCode', { phone: FAKE });
  assert.deepEqual(r.body, { ok: true }, 'a provider that refused is not news for the person typing');
  assert.equal(lines.length, 1);
  assert.match(lines[0], /provider_error/);
  for (const line of lines) {
    assert.equal(line.includes(FAKE), false, 'no number in a log line');
    assert.equal(line.includes(FAKE_E164), false);
    assert.equal(/\d{6}/.test(line), false, 'no code in a log line');
  }
  const code = h.calls.created[0].value;
  assert.equal(/^[0-9a-f]{64}:0$/.test(code), true, 'what is stored is a hash and an attempt count');
});
