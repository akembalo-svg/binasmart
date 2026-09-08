'use strict';
// The HTTP surface of BinaPool, wired the way ride/index.js wires it, against a fake pool module.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Fastify = require('fastify');
const poolRoutes = require('../../ride/pool/routes');

function limiter() { return () => true; }
const clientIp = req => String(req.ip);

async function app(pool) {
  const f = Fastify();
  poolRoutes(f, { pool, riderBotToken: '', drive: { _auth: async (req, reply) => { if (req.body && req.body.initData === 'ok') return { id: 'dA' }; reply.code(401).send({ ok: false }); return null; } }, limiter, clientIp });
  await f.ready();
  return f;
}

test('corridors, join, view, leave and the driver seat tick go through with the right codes', async () => {
  const calls = [];
  const pool = {
    list: async (lat, lng) => { calls.push(['list', lat, lng]); return { peak: true, dir: 'in', waitS: 480, corridors: [] }; },
    join: async a => { calls.push(['join', a]); return a.corridorKey === 'bad' ? { ok: false, error: 'unknown_corridor' } : { ok: true, pool: { id: 'p1', status: 'filling' }, seat: { id: 's1' }, ride: null }; },
    view: async (id, phone) => (id === 'p1' && phone === '+251911000001') ? { ok: true, pool: { id: 'p1' } } : { ok: false, error: 'not_found' },
    leave: async (id, phone) => (id === 'p1' ? { ok: false, error: 'car_already_leaving' } : { ok: false, error: 'not_found' }),
    board: async (rideId, driverId, seatId, status) => ({ ok: true, pool: { seats: [{ id: seatId, status }] }, by: driverId }),
    mine: async () => ({ pool: null }),
  };
  const f = await app(pool);
  let r = await f.inject({ method: 'GET', url: '/api/pool/corridors?lat=9.02&lng=38.80' });
  assert.equal(r.statusCode, 200); assert.equal(r.json().dir, 'in'); assert.deepEqual(calls[0], ['list', 9.02, 38.80]);
  r = await f.inject({ method: 'GET', url: '/api/pool/corridors?lat=1&lng=2' }); // outside Addis -> no bias, still served
  assert.deepEqual(calls[1], ['list', null, null]);
  r = await f.inject({ method: 'POST', url: '/api/pool/join', payload: { corridorKey: 'megenagna-bole:in', stopId: 'megenagna', mode: 'now', riderName: 'Sara', riderPhone: '0911000001' } });
  assert.equal(r.statusCode, 200); assert.equal(r.json().pool.id, 'p1');
  assert.equal(calls[2][1].phone, '+251911000001', 'phone normalised'); assert.equal(calls[2][1].mode, 'now');
  r = await f.inject({ method: 'POST', url: '/api/pool/join', payload: { corridorKey: 'bad', stopId: 'x', riderName: 'Sara', riderPhone: '0911000001' } });
  assert.equal(r.statusCode, 400);
  r = await f.inject({ method: 'POST', url: '/api/pool/join', payload: { corridorKey: 'megenagna-bole:in', stopId: 'megenagna' } });
  assert.equal(r.statusCode, 400, 'name and phone required');
  r = await f.inject({ method: 'GET', url: '/api/pool/p1?phone=0911000001' });
  assert.equal(r.statusCode, 200);
  r = await f.inject({ method: 'GET', url: '/api/pool/p1?phone=0911999999' });
  assert.equal(r.statusCode, 404, 'a stranger cannot watch the pool');
  r = await f.inject({ method: 'POST', url: '/api/pool/p1/leave', payload: { phone: '0911000001' } });
  assert.equal(r.statusCode, 409);
  r = await f.inject({ method: 'POST', url: '/api/drive/pool/r1/seat/s1', payload: { initData: 'ok', status: 'boarded' } });
  assert.equal(r.statusCode, 200); assert.equal(r.json().by, 'dA'); assert.equal(r.json().pool.seats[0].status, 'boarded');
  r = await f.inject({ method: 'POST', url: '/api/drive/pool/r1/seat/s1', payload: { status: 'boarded' } });
  assert.equal(r.statusCode, 401, 'driver auth required');
  await f.close();
});
