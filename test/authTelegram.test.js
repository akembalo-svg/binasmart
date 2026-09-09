'use strict';
// The Telegram sign-in check is the whole door: if it is loose, anyone can post an id and become
// that user. These tests pin the signature, the freshness window and the two key schemes.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const tg = require('../auth/telegram-verify');

const TOKEN = '123456:AAH-fake-bot-token-for-tests';
const NOW = 1757400000000;                 // fixed clock
const AUTH_DATE = Math.floor(NOW / 1000) - 60;

const goodWidget = () => tg.signWidget({ id: 8096525984, first_name: 'Ibrahim', username: 'ibrahim', auth_date: AUTH_DATE }, TOKEN);

test('a correctly signed widget payload is accepted', () => {
  const u = tg.verifyWidget(goodWidget(), TOKEN, { now: NOW });
  assert.ok(u, 'accepted');
  assert.strictEqual(u.id, '8096525984');
  assert.strictEqual(u.firstName, 'Ibrahim');
});

test('a tampered field is rejected', () => {
  const d = goodWidget();
  d.id = 999;                               // pretend to be somebody else, keep the hash
  assert.strictEqual(tg.verifyWidget(d, TOKEN, { now: NOW }), null);
});

test('a payload signed with another bot token is rejected', () => {
  const d = tg.signWidget({ id: 5, first_name: 'X', auth_date: AUTH_DATE }, 'other-token');
  assert.strictEqual(tg.verifyWidget(d, TOKEN, { now: NOW }), null);
});

test('an old payload is rejected, and one from the future too', () => {
  const old = tg.signWidget({ id: 5, first_name: 'X', auth_date: Math.floor(NOW / 1000) - 90000 }, TOKEN);
  assert.strictEqual(tg.verifyWidget(old, TOKEN, { now: NOW }), null);
  const future = tg.signWidget({ id: 5, first_name: 'X', auth_date: Math.floor(NOW / 1000) + 3600 }, TOKEN);
  assert.strictEqual(tg.verifyWidget(future, TOKEN, { now: NOW }), null);
});

test('a missing or malformed hash is rejected', () => {
  const d = goodWidget(); delete d.hash;
  assert.strictEqual(tg.verifyWidget(d, TOKEN, { now: NOW }), null);
  assert.strictEqual(tg.verifyWidget({ ...goodWidget(), hash: 'nope' }, TOKEN, { now: NOW }), null);
});

test('the widget key scheme is NOT the mini app key scheme', () => {
  // sign with the mini-app secret, present it as a widget payload -> must fail
  const entries = [['auth_date', String(AUTH_DATE)], ['first_name', 'X'], ['id', '5']];
  const dcs = entries.map(([k, v]) => k + '=' + v).join('\n');
  const miniSecret = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  const hash = crypto.createHmac('sha256', miniSecret).update(dcs).digest('hex');
  assert.strictEqual(tg.verifyWidget({ id: 5, first_name: 'X', auth_date: AUTH_DATE, hash }, TOKEN, { now: NOW }), null);
});

test('mini app initData is verified with its own scheme', () => {
  const user = JSON.stringify({ id: 8096525984, first_name: 'Ibrahim' });
  const entries = [['auth_date', String(AUTH_DATE)], ['user', user]];
  const dcs = entries.map(([k, v]) => k + '=' + v).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  const hash = crypto.createHmac('sha256', secret).update(dcs).digest('hex');
  const qs = new URLSearchParams([...entries, ['hash', hash]]).toString();
  const u = tg.verifyInitData(qs, TOKEN, { now: NOW });
  assert.ok(u);
  assert.strictEqual(u.id, '8096525984');
  assert.strictEqual(tg.verifyInitData(qs, 'wrong-token', { now: NOW }), null);
});

test('placeholder emails are recognisable and unique per Telegram id', () => {
  const a = tg.placeholderEmail('8096525984'), b = tg.placeholderEmail('8825386029');
  assert.notStrictEqual(a, b);
  assert.ok(tg.isPlaceholderEmail(a));
  assert.ok(!tg.isPlaceholderEmail('someone@gmail.com'));
});

test('a photo url is only kept when it is https', () => {
  const d = tg.signWidget({ id: 5, first_name: 'X', auth_date: AUTH_DATE, photo_url: 'http://evil/x.jpg' }, TOKEN);
  assert.strictEqual(tg.verifyWidget(d, TOKEN, { now: NOW }).photoUrl, '');
});

// The endpoint itself: a forged payload must never reach the database.
test('the sign-in endpoint refuses an unsigned payload', async () => {
  process.env.BINA_RIDER_BOT_TOKEN = process.env.BINA_RIDER_BOT_TOKEN || TOKEN;
  const { auth } = await import('../auth.mjs');
  assert.ok(typeof auth.api.signInTelegram === 'function', 'endpoint is mounted');
  let status = null;
  try {
    await auth.api.signInTelegram({ body: { widget: { id: 5, first_name: 'X', auth_date: AUTH_DATE, hash: 'a'.repeat(64) } } });
  } catch (e) { status = e.status || e.statusCode || e.body?.code || 'threw'; }
  assert.ok(status, 'a forged payload is rejected before any user is created');
});

test('the login page only offers doors the server reports', () => {
  const fs = require('fs'), path = require('path');
  const h = fs.readFileSync(path.join(__dirname, '..', 'public', 'login.html'), 'utf8');
  assert.ok(h.includes('/api/auth-methods'), 'asks the server which doors exist');
  assert.ok(h.includes('sign-in/telegram') && h.includes('sign-in/social'), 'both doors wired');
  assert.ok(h.includes('telegram-widget.js'), 'loads the official widget');
  assert.ok(/NEXT\s*=\s*'\/'/.test(h), 'open redirects are blocked with a safe default');
  const s = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.ok(s.includes("fastify.get('/api/auth-methods'"), 'the endpoint exists');
});

test('new accounts are not owners', async () => {
  const fs = require('fs'), path = require('path');
  const a = fs.readFileSync(path.join(__dirname, '..', 'auth.mjs'), 'utf8');
  assert.ok(/defaultValue:\s*'user'/.test(a), "role defaults to 'user', never 'owner'");
  assert.ok(a.includes('GOOGLE_CLIENT_ID'), 'google is env-gated');
});

test('a door the server has not configured stays hidden', () => {
  const fs = require('fs'), path = require('path');
  const h = fs.readFileSync(path.join(__dirname, '..', 'public', 'login.html'), 'utf8');
  // .gbtn is display:flex, which overrides the `hidden` attribute unless this rule exists
  assert.ok(/\[hidden\]\{display:none!important\}/.test(h), 'hidden wins over the display rules');
});
