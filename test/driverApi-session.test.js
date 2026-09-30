'use strict';
// The driver app outside Telegram (Bina Partner Android app): a signed-in bina.et account reaches its OWN
// driver row through Driver.authUserId, and a Telegram request is still judged only by its signature.
// Invented drivers, no phone numbers.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeDriverApi } = require('../ride/driverApi');
const tgauth = require('../ride/tgauth');

const TOKEN = '111111111:TEST-DRIVER-BOT-TOKEN';
const T0 = 1_700_000_000_000;

function reply() {
  const r = { statusCode: 200, body: null };
  r.code = c => { r.statusCode = c; return r; };
  r.send = b => { r.body = b; return r; };
  return r;
}
function world() {
  const drivers = [
    { id: 'd1', name: 'Abel', telegramId: '900001', authUserId: 'acct-abel', tier: 'economy', plate: 'AA 00001', status: 'approved', online: false, away: false, onRideId: null, rating: 5, ridesCount: 0, earningsTodayEtb: 0 },
    { id: 'd2', name: 'Bekele', telegramId: '900002', authUserId: 'acct-bekele', tier: 'economy', plate: 'AA 00002', status: 'pending', online: false, away: false, onRideId: null, rating: 5, ridesCount: 0, earningsTodayEtb: 0 },
  ];
  const seen = [];
  const prisma = {
    driver: {
      findFirst: async ({ where }) => {
        seen.push(where);
        return drivers.find(d => Object.entries(where).every(([k, v]) => d[k] === v)) || null;
      },
      findUnique: async ({ where }) => drivers.find(d => d.id === where.id) || null,
      update: async ({ where, data }) => Object.assign(drivers.find(d => d.id === where.id), data),
    },
    ride: { findUnique: async () => null },
    rideOffer: { findMany: async () => [] },
  };
  const api = makeDriverApi({ prisma, driverBotToken: TOKEN, location: { forget() {} }, offers: {}, settings: { get: async () => ({ offerWindowS: 25 }) }, geo: {}, telegram: {}, riderNotify: {}, now: () => T0 });
  return { api, drivers, seen };
}
const req = (authUser, body) => ({ body: body || {}, query: {}, params: {}, authUser: authUser || null });

test('a signed-in account opens its own approved driver row, without initData', async () => {
  const w = world();
  const s = await w.api.session(req({ id: 'acct-abel' }), reply());
  assert.equal(s.ok, true);
  assert.equal(s.driver.name, 'Abel');
  assert.deepEqual(w.seen[0], { authUserId: 'acct-abel' }, 'matched on the account id only');
});

test('an account with no driver row gets not_registered; no session and no initData gets 401', async () => {
  const w = world();
  const r1 = reply();
  await w.api.session(req({ id: 'acct-stranger' }), r1);
  assert.equal(r1.statusCode, 404);
  assert.equal(r1.body.error, 'not_registered');
  const r2 = reply();
  await w.api.session(req(null), r2);
  assert.equal(r2.statusCode, 401);
});

test('a pending driver signed in on the web sees their status but cannot go online', async () => {
  const w = world();
  const s = await w.api.session(req({ id: 'acct-bekele' }), reply());
  assert.equal(s.driver.status, 'pending');
  const r = reply();
  await w.api.online(req({ id: 'acct-bekele' }, { online: true }), r);
  assert.equal(r.statusCode, 403);
  assert.equal(r.body.error, 'awaiting_approval');
});

test('when initData is sent it alone decides: a forged one is refused even with a session present', async () => {
  const w = world();
  const r = reply();
  await w.api.session(req({ id: 'acct-abel' }, { initData: 'user=%7B%22id%22%3A900001%7D&hash=' + 'a'.repeat(64) }), r);
  assert.equal(r.statusCode, 401);
  assert.equal(r.body.error, 'telegram_auth_invalid');
  // and a valid Telegram driver is still found by telegramId, not by whoever holds the cookie
  const good = tgauth.sign({ auth_date: String(Math.floor(T0 / 1000)), user: { id: 900002, first_name: 'Bekele' } }, TOKEN);
  const s = await w.api.session(req({ id: 'acct-abel' }, { initData: good }), reply());
  assert.equal(s.driver.name, 'Bekele');
});

test('the approved driver can go online from the web session', async () => {
  const w = world();
  const s = await w.api.online(req({ id: 'acct-abel' }, { online: true }), reply());
  assert.equal(s.ok, true);
  assert.equal(w.drivers[0].online, true);
});
