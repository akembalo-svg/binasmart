import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RideApiError } from '../lib/rideApi.mjs';
import { parsePlace, resolvePlace, registerRideTools } from '../tools/ride.mjs';

const json = d => ({ content: [{ type: 'text', text: JSON.stringify(d) }] });
const wrap = (_n, fn) => fn;
const out = r => JSON.parse(r.content[0].text);

function fakeApi(over = {}) {
  return {
    search: async q => ({ ok: true, results: q === 'edna' ? [{ kind: 'building', label: 'Edna Mall', labelAm: 'ኤድና ሞል', sub: 'Bole', lat: 9.0, lng: 38.78 }]
      : q === 'bole' ? [{ label: 'Bole Medhanealem', lat: 9.01, lng: 38.79 }, { label: 'Bole Airport', lat: 8.98, lng: 38.8 }] : [] }),
    quote: async () => ({ ok: true, distanceM: 5200, durationS: 900, estimate: false, geometry: [[0, 0]], quotes: [{ tier: 'economy', fareEtb: 250, driverTakeEtb: 212, km: 5.2, etaMin: 15, label: 'Economy', labelAm: 'ኢኮኖሚ', icon: '🚗', seats: 4 }] }),
    request: async b => ({ ok: true, ride: { id: 'r1', status: 'dispatching', fareEtb: 250, tier: b.tier, pickup: b.pickup, dropoff: b.dropoff, driver: null } }),
    status: async () => ({ ok: true, ride: { id: 'r1', status: 'assigned', fareEtb: 250, driver: { name: 'Abel', phone: '+251900000000', plate: 'A12345', vehicle: 'white Toyota Vitz', rating: 4.9 } } }),
    cancel: async () => ({ ok: true, ride: { id: 'r1', status: 'cancelled' } }),
    ...over,
  };
}
function tools(api) {
  const reg = {};
  registerRideTools({ registerTool: (name, _def, fn) => { reg[name] = fn; } }, { api, wrap, json });
  return reg;
}

test('parsePlace: "lat,lng" → point, else null', () => {
  assert.deepEqual(parsePlace('9.0108, 38.7578'), { lat: 9.0108, lng: 38.7578 });
  assert.equal(parsePlace('Edna Mall'), null);
  assert.equal(parsePlace('50,50'), null, 'outside Addis box');
});

test('resolvePlace: unique hit → point; several → candidates; none → not_found', async () => {
  const api = fakeApi();
  const a = await resolvePlace(api, 'edna');
  assert.deepEqual(a, { ok: true, point: { lat: 9.0, lng: 38.78, label: 'Edna Mall' } });
  const b = await resolvePlace(api, 'bole');
  assert.equal(b.ok, false); assert.equal(b.candidates.length, 2);
  const c = await resolvePlace(api, 'zzz');
  assert.equal(c.ok, false); assert.equal(c.error, 'not_found');
  const d = await resolvePlace(api, '9.01,38.75');
  assert.equal(d.ok, true); assert.equal(d.point.label, '9.01000, 38.75000');
});

test('quote_ride returns fares without geometry/driverTake, or candidates when ambiguous', async () => {
  const t = tools(fakeApi());
  const r = out(await t.quote_ride({ pickup: 'edna', dropoff: '9.03,38.75' }));
  assert.equal(r.quotes[0].fare_etb, 250);
  assert.equal(r.quotes[0].driverTakeEtb, undefined);
  assert.equal(r.geometry, undefined);
  assert.equal(r.distance_km, 5.2);
  assert.equal(r.source_url, 'https://bina.et/ride');
  const amb = await t.quote_ride({ pickup: 'bole', dropoff: 'edna' });
  assert.equal(amb.isError, true);
  assert.match(amb.content[0].text, /Bole Medhanealem/);
});

test('request_ride validates phone and tier, books, returns tracking url', async () => {
  const t = tools(fakeApi());
  const bad = await t.request_ride({ tier: 'economy', pickup: 'edna', dropoff: '9.03,38.75', rider_name: 'Sara', rider_phone: '12345' });
  assert.equal(bad.isError, true); assert.match(bad.content[0].text, /\+251/);
  const ok = out(await t.request_ride({ tier: 'economy', pickup: 'edna', dropoff: '9.03,38.75', rider_name: 'Sara', rider_phone: '0911244344' }));
  assert.equal(ok.ride_id, 'r1');
  assert.equal(ok.tracking_url, 'https://bina.et/ride?id=r1');
  assert.equal(ok.fare_etb, 250);
  assert.match(ok.next_step, /read the fare/i);
});

test('request_ride can book for someone else: passenger becomes the rider, booker phone may be foreign', async () => {
  let sent = null;
  const t = tools(fakeApi({ request: async b => { sent = b; return { ok: true, ride: { id: 'r9', status: 'dispatching', fareEtb: 250, tier: b.tier, pickup: b.pickup, dropoff: b.dropoff, driver: null } }; } }));
  const ok = out(await t.request_ride({ tier: 'economy', pickup: 'edna', dropoff: '9.03,38.75', rider_name: 'Ibrahim', rider_phone: '+447700900123', passenger_name: 'Almaz', passenger_phone: '0922333444' }));
  assert.equal(ok.ride_id, 'r9');
  assert.deepEqual(sent.passenger, { name: 'Almaz', phone: '+251922333444' });
  assert.equal(sent.riderPhone, '+447700900123');
  assert.equal(ok.booked_for, 'Almaz');
  const bad = await t.request_ride({ tier: 'economy', pickup: 'edna', dropoff: '9.03,38.75', rider_name: 'Ibrahim', rider_phone: '+447700900123' });
  assert.equal(bad.isError, true, 'foreign booker without a passenger is rejected');
});

test('get_ride_status / cancel_ride pass phone through and map errors', async () => {
  const t = tools(fakeApi());
  const s = out(await t.get_ride_status({ ride_id: 'r1', rider_phone: '0911244344' }));
  assert.equal(s.status, 'assigned'); assert.equal(s.driver.plate, 'A12345');
  const c = out(await t.cancel_ride({ ride_id: 'r1', rider_phone: '0911244344' }));
  assert.equal(c.status, 'cancelled');
  const t2 = tools(fakeApi({ status: async () => { throw new RideApiError('not_found', { status: 404 }); } }));
  const nf = await t2.get_ride_status({ ride_id: 'zz', rider_phone: '0911244344' });
  assert.equal(nf.isError, true); assert.match(nf.content[0].text, /not found|phone/i);
  const t3 = tools(fakeApi({ quote: async () => { throw new RideApiError('network', { kind: 'network' }); } }));
  const down = await t3.quote_ride({ pickup: 'edna', dropoff: '9.03,38.75' });
  assert.equal(down.isError, true); assert.match(down.content[0].text, /temporarily unavailable/);
  const t4 = tools(fakeApi({ quote: async () => { throw new RideApiError('slow_down', { status: 429 }); } }));
  const slow = await t4.quote_ride({ pickup: 'edna', dropoff: '9.03,38.75' });
  assert.match(slow.content[0].text, /slow down/i);
  const t5 = tools(fakeApi({ cancel: async () => { throw new RideApiError('cannot_cancel_now', { status: 409 }); } }));
  const late = await t5.cancel_ride({ ride_id: 'r1', rider_phone: '0911244344' });
  assert.match(late.content[0].text, /no longer be cancelled/);
});
