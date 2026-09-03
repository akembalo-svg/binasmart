import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { makeRideApi, RideApiError } from '../lib/rideApi.mjs';

// Stub ride API: path decides the behaviour. Never the live API.
const seen = [];
const stub = http.createServer((req, res) => {
  let body = ''; req.on('data', c => body += c); req.on('end', () => {
    seen.push({ method: req.method, url: req.url, headers: req.headers, body: body && JSON.parse(body) });
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.url.startsWith('/api/ride/search')) return send(200, { ok: true, results: [{ kind: 'building', label: 'Edna Mall', labelAm: 'ኤድና ሞል', sub: 'Bole', lat: 9.0, lng: 38.78, slug: 'edna' }] });
    if (req.url === '/api/ride/quote') return send(200, { ok: true, distanceM: 5200, durationS: 900, estimate: false, geometry: [[1, 2]], quotes: [{ tier: 'economy', fareEtb: 250, driverTakeEtb: 212, km: 5.2, etaMin: 15, label: 'Economy', labelAm: 'ኢኮኖሚ', icon: '🚗', seats: 4 }] });
    if (req.url === '/api/ride/request') return send(200, { ok: true, ride: { id: 'r1', status: 'dispatching', fareEtb: 250 } });
    if (req.url === '/api/ride/r400/cancel') return send(400, { ok: false, error: 'bad thing' });
    if (req.url === '/api/ride/r429/cancel') return send(429, { ok: false, error: 'slow_down' });
    if (req.url === '/api/ride/r500/cancel') return send(500, { ok: false });
    if (req.url === '/api/ride/slow/cancel') return; // never answers → timeout
    if (req.url.startsWith('/api/ride/r1?phone=')) return send(200, { ok: true, ride: { id: 'r1', status: 'assigned' } });
    send(404, { ok: false, error: 'not_found' });
  });
});
await new Promise(r => stub.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${stub.address().port}`;
after(() => stub.close());

test('search / quote / status / cancel round-trip', async () => {
  const api = makeRideApi({ baseUrl: base, timeoutMs: 500 });
  const s = await api.search('edna');
  assert.equal(s.results[0].label, 'Edna Mall');
  const q = await api.quote({ lat: 9, lng: 38.7 }, { lat: 9.03, lng: 38.75 });
  assert.equal(q.quotes[0].fareEtb, 250);
  const st = await api.status('r1', '+251911244344');
  assert.equal(st.ride.status, 'assigned');
  assert.equal(seen.at(-1).url, '/api/ride/r1?phone=%2B251911244344');
});

test('request sends synthetic X-Real-IP derived from the phone', async () => {
  const api = makeRideApi({ baseUrl: base, timeoutMs: 500 });
  await api.request({ tier: 'economy', pickup: { lat: 9, lng: 38.7 }, dropoff: { lat: 9.03, lng: 38.75 }, riderName: 'Test', riderPhone: '+251911244344', paymentMethod: 'cash', idemKey: 'k' });
  const h = seen.at(-1).headers;
  assert.match(h['x-real-ip'], /^mcp-[a-f0-9]{12}$/);
  const again = await api.request({ tier: 'economy', pickup: { lat: 9, lng: 38.7 }, dropoff: { lat: 9.03, lng: 38.75 }, riderName: 'Test', riderPhone: '+251911244344', paymentMethod: 'cash', idemKey: 'k' });
  assert.equal(seen.at(-1).headers['x-real-ip'], h['x-real-ip'], 'same phone → same synthetic IP');
  assert.equal(again.ride.id, 'r1');
});

test('non-2xx becomes RideApiError with status and API message; timeout/network too', async () => {
  const api = makeRideApi({ baseUrl: base, timeoutMs: 300 });
  await assert.rejects(api.cancel('r400', '+251911244344'), e => e instanceof RideApiError && e.status === 400 && e.message === 'bad thing');
  await assert.rejects(api.cancel('r429', '+251911244344'), e => e.status === 429);
  await assert.rejects(api.cancel('r500', '+251911244344'), e => e.status === 500);
  await assert.rejects(api.cancel('slow', '+251911244344'), e => e instanceof RideApiError && e.status === 0 && e.kind === 'timeout');
  const dead = makeRideApi({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 300 });
  await assert.rejects(dead.search('x'), e => e instanceof RideApiError && e.status === 0 && e.kind === 'network');
});
