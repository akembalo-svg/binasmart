'use strict';
// Bini's ride points are grounded to places we returned (assistant/tools.js ground()). Measured 30 Sep 2026: after a
// Bole -> Piassa quote, "and with bajaj?" re-quoted with invented coordinates and gave a different fare each run.
const test = require('node:test');
const assert = require('node:assert');
const { makeExecutor } = require('../assistant/tools');

const PLACES = {
  'bole': [{ label: 'Bole Medhanialem', labelAm: 'ቦሌ መድኃኒዓለም', sub: 'Bole', lat: 8.9975, lng: 38.7876 }, { label: 'Bole Bulbula', sub: 'Bole', lat: 8.9500, lng: 38.7800 }],
  'piassa': [{ label: 'Piassa (Arada)', labelAm: 'ፒያሳ', sub: 'Arada', lat: 9.0336, lng: 38.7507 }],
  'bole airport': [{ label: 'Bole International Airport', sub: 'Bole', lat: 8.9806, lng: 38.7992 }],
  'piazza': [{ label: 'Piassa (Arada)', sub: 'Arada', lat: 9.0336, lng: 38.7507 }],
  'megenagna': [{ label: 'Kality', sub: 'Akaki', lat: 8.9000, lng: 38.7700 }],   // unrelated and far: must not be used
};
function fakeApi(places = PLACES) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    const body = opts && opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url, body });
    const j = d => ({ ok: true, status: 200, json: async () => d });
    const m = /\/api\/ride\/search\?q=([^&]*)/.exec(url);
    if (m) return j({ ok: true, results: places[decodeURIComponent(m[1]).toLowerCase()] || [] });
    if (/\/api\/ride\/quote/.test(url)) return j({ ok: true, distanceM: 5000, durationS: 900, quotes: [{ tier: 'bajaj', label: 'Bajaj', seats: 3, fareEtb: 185 }] });
    if (/\/api\/ride\/request/.test(url)) return j({ ok: true, ride: { id: 'r7', status: 'searching', fareEtb: 185 } });
    return { ok: false, status: 404, json: async () => ({ error: 'not_found' }) };
  };
  return { calls, fetchImpl };
}
const lastBody = (calls, re) => calls.filter(c => re.test(c.url)).pop().body;
let n = 0; const ip = () => 'bini-eval:web:grounding' + (++n) + '-' + Date.now();

test('a follow-up quote with invented coordinates reuses the trip just quoted', async () => {
  const api = fakeApi(), who = ip();
  const turn1 = makeExecutor({ base: 'http://x', fetchImpl: api.fetchImpl, ip: who });
  const b = (await turn1('search_places', { q: 'Bole' })).results[0], p = (await turn1('search_places', { q: 'Piassa' })).results[0];
  const q1 = await turn1('quote_ride', { pickup: { lat: b.lat, lng: b.lng, label: 'Bole' }, dropoff: { lat: p.lat, lng: p.lng, label: 'Piassa' } });
  assert.equal(q1.from, 'Bole');
  const first = lastBody(api.calls, /ride\/quote/);
  // the next request is a new executor, as in server.js; the model now guesses the points itself
  const turn2 = makeExecutor({ base: 'http://x', fetchImpl: api.fetchImpl, ip: who });
  await turn2('quote_ride', { pickup: { lat: 9.005, lng: 38.79, label: 'Bole' }, dropoff: { lat: 9.03, lng: 38.745, label: 'Piassa' } });
  const second = lastBody(api.calls, /ride\/quote/);
  assert.deepEqual([second.pickup.lat, second.pickup.lng, second.dropoff.lat, second.dropoff.lng], [first.pickup.lat, first.pickup.lng, first.dropoff.lat, first.dropoff.lng]);
});

test('points we returned are used as given; a less specific label never swallows a more specific place', async () => {
  const api = fakeApi(), who = ip(), run = makeExecutor({ base: 'http://x', fetchImpl: api.fetchImpl, ip: who });
  await run('search_places', { q: 'Bole' });
  await run('quote_ride', { pickup: { lat: 8.9975, lng: 38.7876, label: 'Bole' }, dropoff: { lat: 9.0336, lng: 38.7507, label: 'Piassa' } });
  const exact = lastBody(api.calls, /ride\/quote/);
  assert.deepEqual([exact.pickup.lat, exact.pickup.lng], [8.9975, 38.7876]);
  // "Bole Airport" is not the plain "Bole" of the last trip: it is looked up and the airport is used
  await run('quote_ride', { pickup: { lat: 8.99, lng: 38.80, label: 'Bole Airport' }, dropoff: { lat: 9.0336, lng: 38.7507, label: 'Piassa' } });
  const airport = lastBody(api.calls, /ride\/quote/);
  assert.deepEqual([airport.pickup.lat, airport.pickup.lng, airport.pickup.label], [8.9806, 38.7992, 'Bole International Airport']);
});

test('a map result is used only when its name fits the label or it is within 2 km of the guess', async () => {
  const api = fakeApi(), run = makeExecutor({ base: 'http://x', fetchImpl: api.fetchImpl, ip: ip() });
  // "Piazza" is spelled differently from "Piassa (Arada)" but the result is 400 m from the guess: used
  await run('quote_ride', { pickup: { lat: 9.0366, lng: 38.7520, label: 'Piazza' }, dropoff: { lat: 8.9975, lng: 38.7876, label: 'Bole' } });
  const near = lastBody(api.calls, /ride\/quote/);
  assert.deepEqual([near.pickup.lat, near.pickup.lng], [9.0336, 38.7507]);
  // "Megenagna" returns an unrelated place 13 km away: the guess stands
  await run('quote_ride', { pickup: { lat: 9.0200, lng: 38.8000, label: 'Megenagna' }, dropoff: { lat: 8.9975, lng: 38.7876, label: 'Bole' } });
  const far = lastBody(api.calls, /ride\/quote/);
  assert.deepEqual([far.pickup.lat, far.pickup.lng], [9.02, 38.8]);
});

test('a point given only by name is found on our map; nothing found is still an error', async () => {
  const api = fakeApi(), run = makeExecutor({ base: 'http://x', fetchImpl: api.fetchImpl, ip: ip() });
  const q = await run('quote_ride', { pickup: { label: 'Bole Airport' }, dropoff: { label: 'Piassa' } });
  assert.equal(q.to, 'Piassa (Arada)');
  const bad = await run('quote_ride', { pickup: { label: 'Nowhere Street' }, dropoff: { label: 'Piassa' } });
  assert.match(bad.error, /inside Addis/);
});

test('request_ride books the grounded points, and conversations without a key do not share trips', async () => {
  const api = fakeApi(), who = ip();
  const turn1 = makeExecutor({ base: 'http://x', fetchImpl: api.fetchImpl, ip: who });
  await turn1('search_places', { q: 'Bole' }); await turn1('search_places', { q: 'Piassa' });
  await turn1('quote_ride', { pickup: { lat: 8.9975, lng: 38.7876, label: 'Bole' }, dropoff: { lat: 9.0336, lng: 38.7507, label: 'Piassa' } });
  const turn2 = makeExecutor({ base: 'http://x', fetchImpl: api.fetchImpl, ip: who });
  const ok = await turn2('request_ride', { pickup: { lat: 9.01, lng: 38.79, label: 'Bole' }, dropoff: { lat: 9.02, lng: 38.74, label: 'Piassa' }, tier: 'bajaj', riderPhone: '0900000011', confirmed: true });
  assert.equal(ok.rideId, 'r7');
  const booked = lastBody(api.calls, /ride\/request/);
  assert.deepEqual([booked.pickup.lat, booked.pickup.lng, booked.dropoff.lat, booked.dropoff.lng], [8.9975, 38.7876, 9.0336, 38.7507]);
  // no conversation key: a fresh executor knows nothing, so "Bole" is looked up (Bole Medhanialem is the nearest fit)
  const anon = makeExecutor({ base: 'http://x', fetchImpl: api.fetchImpl });
  await anon('quote_ride', { pickup: { lat: 8.99, lng: 38.785, label: 'Bole' }, dropoff: { lat: 9.0336, lng: 38.7507, label: 'Piassa' } });
  const a = lastBody(api.calls, /ride\/quote/);
  assert.deepEqual([a.pickup.lat, a.pickup.lng], [8.9975, 38.7876]);
});

test('a follow-up that searched again and picked another point with the same name keeps the trip it quoted', async () => {
  // what our own map returned on 30 Sep 2026: three points called "Bole", two called "Piassa"
  const api = fakeApi({ bole: [{ label: 'Bole', lat: 8.9867, lng: 38.7934 }, { label: 'Bole', lat: 8.9667, lng: 38.9 }, { label: 'Bole', lat: 8.9908, lng: 38.7927 }],
    piassa: [{ label: 'Piassa', lat: 9.0346, lng: 38.7549 }, { label: 'Piassa', lat: 9.0351, lng: 38.7493 }] }), who = ip();
  const turn1 = makeExecutor({ base: 'http://x', fetchImpl: api.fetchImpl, ip: who });
  await turn1('search_places', { q: 'Bole' }); await turn1('search_places', { q: 'Piassa' });
  await turn1('quote_ride', { pickup: { lat: 8.9867, lng: 38.7934, label: 'Bole' }, dropoff: { lat: 9.0346, lng: 38.7549, label: 'Piassa' } });
  const first = lastBody(api.calls, /ride\/quote/);
  const turn2 = makeExecutor({ base: 'http://x', fetchImpl: api.fetchImpl, ip: who });
  await turn2('search_places', { q: 'Bole' }); await turn2('search_places', { q: 'Piassa' });
  // the other "Bole" 460 m away and the other "Piassa" 600 m away: the trip wins
  await turn2('quote_ride', { pickup: { lat: 8.9908, lng: 38.7927, label: 'Bole' }, dropoff: { lat: 9.0351, lng: 38.7493, label: 'Piassa' } });
  const second = lastBody(api.calls, /ride\/quote/);
  assert.deepEqual([second.pickup.lat, second.pickup.lng, second.dropoff.lat, second.dropoff.lng], [first.pickup.lat, first.pickup.lng, first.dropoff.lat, first.dropoff.lng]);
  // the "Bole" 12 km east is a different place the map returned: it stands
  await turn2('quote_ride', { pickup: { lat: 8.9667, lng: 38.9, label: 'Bole' }, dropoff: { lat: 9.0346, lng: 38.7549, label: 'Piassa' } });
  const far = lastBody(api.calls, /ride\/quote/);
  assert.deepEqual([far.pickup.lat, far.pickup.lng], [8.9667, 38.9]);
});

test('an evaluation never books: request_ride stops after its checks and grounding', async () => {
  const api = fakeApi(), run = makeExecutor({ base: 'http://x', fetchImpl: api.fetchImpl, ip: ip(), dryRun: true });
  const r = await run('request_ride', { pickup: { label: 'Bole Airport' }, dropoff: { label: 'Piassa' }, tier: 'bajaj', riderPhone: '0900000011', confirmed: true });
  assert.equal(r.dryRun, true); assert.equal(r.wouldSend.pickup.label, 'Bole International Airport');
  assert.equal(api.calls.some(c => /ride\/request/.test(c.url)), false, 'no ride request may leave an evaluation');
  const bad = await run('request_ride', { pickup: { lat: 9.02, lng: 38.8 }, dropoff: { lat: 9, lng: 38.79 }, tier: 'bajaj', riderPhone: '12345', confirmed: true });
  assert.match(bad.error, /Ethiopian mobile/);   // the checks still run
});
