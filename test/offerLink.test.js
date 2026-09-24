'use strict';
// bina.et/o/<token>: the SMS offer page for a weak-signal driver with no Telegram. Every number is invented.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Fastify = require('fastify');
const { makeOfferLink, offerSmsText, offerPage } = require('../ride/offerLink');

const links = makeOfferLink({ secret: 'test-secret-000000000000', baseUrl: 'https://bina.et' });

function setup() {
  const t0 = 1_000_000_000;
  const clock = { t: t0 + 5000 };
  const state = {
    offers: [{ id: 'off1abc', rideId: 'r1', driverId: 'dP', status: 'open', etaS: 240, distanceM: 1200, createdAt: new Date(t0) },
             { id: 'off2xyz', rideId: 'r1', driverId: 'dQ', status: 'open', etaS: 300, distanceM: 1500, createdAt: new Date(t0) }],
    ride: { id: 'r1', status: 'dispatching', driverId: null, riderName: 'Sara', riderPhone: '+251900000077', fareEtb: 295, driverTakeEtb: 295,
            paymentMethod: 'cash', distanceM: 5000, pickup: { lat: 9.01, lng: 38.76, label: 'Edna Mall' }, dropoff: { lat: 9.04, lng: 38.75, label: 'Piassa' } },
  };
  const calls = [];
  const prisma = {
    rideOffer: { findUnique: async ({ where }) => state.offers.find(o => o.id === where.id) || null },
    ride: { findUnique: async ({ where }) => (where.id === state.ride.id ? { ...state.ride } : null) },
  };
  const offers = {
    accept: async (rideId, driverId) => {
      calls.push(['accept', rideId, driverId]);
      if (state.ride.driverId) return { ok: false, error: 'taken' };
      Object.assign(state.ride, { driverId, status: 'assigned' });
      state.offers.forEach(o => { o.status = o.driverId === driverId ? 'accepted' : 'lost'; });
      return { ok: true };
    },
    decline: async (rideId, driverId) => { calls.push(['decline', rideId, driverId]); state.offers.find(o => o.driverId === driverId).status = 'declined'; return { ok: true }; },
  };
  const app = Fastify();
  offerPage(app, { prisma, offers, links, settings: { get: async () => ({ offerWindowS: 25 }) }, baseUrl: 'https://bina.et', now: () => clock.t });
  return { app, state, calls, clock };
}
const form = body => ({ 'content-type': 'application/x-www-form-urlencoded' });

test('the token names one offer and cannot be forged or moved to another', () => {
  const t = links.token('off1abc');
  assert.equal(links.verify(t), 'off1abc');
  assert.equal(links.verify('off2xyz.' + t.split('.')[1]), null, 'a signature does not fit another offer');
  assert.equal(links.verify(t.slice(0, -1) + (t.endsWith('A') ? 'B' : 'A')), null);
  assert.equal(links.verify('nonsense'), null);
  assert.equal(links.url('off1abc'), 'https://bina.et/o/' + t);
});

test('the SMS is short, names the pickup and the pay, and ends with the link', () => {
  const s = offerSmsText({ pickup: { label: 'Edna Mall' }, driverTakeEtb: 295 }, 240, 'https://bina.et/o/x.y');
  assert.match(s, /Pickup: Edna Mall \(4 min\)/);
  assert.match(s, /You earn 295 ETB/);
  assert.ok(s.endsWith('https://bina.et/o/x.y'));
  assert.ok(('BinaSmart Ride፦ ' + s).length < 200, 'well inside one Unicode message budget of three parts');
});

test('opening the link shows the offer and changes nothing; the passenger\'s phone is not shown yet', async () => {
  const { app, calls } = setup();
  const r = await app.inject({ method: 'GET', url: '/o/' + links.token('off1abc') });
  assert.equal(r.statusCode, 200);
  assert.match(r.body, /Edna Mall/);
  assert.match(r.body, /295 ETB/);
  assert.match(r.body, /name="do" value="accept"/);
  assert.doesNotMatch(r.body, /900000077/, 'no phone before the ride is his');
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.equal(calls.length, 0, 'GET never accepts: SMS apps open links by themselves');
});

test('Accept takes the ride for that driver and the page then shows the passenger and directions', async () => {
  const { app, calls } = setup();
  const t = links.token('off1abc');
  const r = await app.inject({ method: 'POST', url: '/o/' + t, headers: form(), payload: 'do=accept' });
  assert.equal(r.statusCode, 303);
  assert.deepEqual(calls, [['accept', 'r1', 'dP']]);
  const v = await app.inject({ method: 'GET', url: '/o/' + t });
  assert.match(v.body, /Sara/);
  assert.match(v.body, /tel:\+251900000077/);
  assert.match(v.body, /google\.com\/maps\/dir\/\?api=1&amp;destination=9\.01,38\.76/);
  const other = await app.inject({ method: 'GET', url: '/o/' + links.token('off2xyz') });
  assert.doesNotMatch(other.body, /900000077/, 'the losing driver never sees the passenger');
  assert.match(other.body, /Another driver got this one/);
});

test('Skip declines only this offer; a late or forged link says so', async () => {
  const s = setup();
  const r = await s.app.inject({ method: 'POST', url: '/o/' + links.token('off1abc'), headers: form(), payload: 'do=skip' });
  assert.match(r.body, /Skipped/);
  assert.deepEqual(s.calls, [['decline', 'r1', 'dP']]);
  const late = setup(); late.clock.t += 60 * 1000;
  const l = await late.app.inject({ method: 'GET', url: '/o/' + links.token('off2xyz') });
  assert.match(l.body, /expired/);
  const bad = await s.app.inject({ method: 'GET', url: '/o/off1abc.AAAAAAAAAAAA' });
  assert.equal(bad.statusCode, 404);
});
