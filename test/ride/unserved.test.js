'use strict';
// A ride request nobody could serve is closed after ten minutes and the rider is told. Everything is invented.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeDispatch } = require('../../ride/dispatch');

const T = 1_800_000_000_000;
function harness(rides) {
  const notes = [], told = [];
  const inWaiting = s => ['requested', 'dispatching'].includes(s);
  const prisma = {
    ride: {
      findMany: async ({ where }) => Object.values(rides).filter(r => inWaiting(r.status) && r.concierge === where.concierge
        && r.driverId === null && !r.pool && r.requestedAt < where.requestedAt.lt).map(r => ({ id: r.id, tier: r.tier, fareEtb: r.fareEtb })),
      updateMany: async ({ where, data }) => {
        const r = rides[where.id];
        if (!r || !where.status.in.includes(r.status) || r.driverId !== null) return { count: 0 };
        Object.assign(r, data); return { count: 1 };
      },
    },
    rideOffer: { updateMany: async () => ({ count: 0 }) },
  };
  const telegram = { conciergeAlert: async () => true, ownerNote: async t => { notes.push(t); return true; } };
  const d = makeDispatch({ prisma, telegram, settings: { get: async () => ({ conciergeAfterS: 60 }) }, setTimeoutFn: () => ({}), clearTimeoutFn: () => {} });
  return { d, rides, notes, told, notify: id => { told.push(id); } };
}
const ride = (id, mins, extra) => Object.assign({ id, status: 'dispatching', concierge: true, driverId: null, pool: null, tier: 'economy', fareEtb: 230,
  requestedAt: new Date(T - mins * 60000) }, extra || {});

test('a request with no driver for over ten minutes is closed as nodriver, the rider is told once, the owner gets one line', async () => {
  const h = harness({ a: ride('a', 11), b: ride('b', 4) });
  assert.equal(await h.d.sweepUnserved(T, h.notify), 1);
  assert.equal(h.rides.a.status, 'cancelled');
  assert.equal(h.rides.a.cancelledBy, 'nodriver');
  assert.equal(h.rides.b.status, 'dispatching', 'a younger request keeps waiting');
  assert.deepEqual(h.told, ['a']);
  assert.equal(h.notes.length, 1);
  assert.match(h.notes[0], /No driver within 10 min/);
  assert.equal(await h.d.sweepUnserved(T, h.notify), 0, 'nothing is closed or told twice');
  assert.deepEqual(h.told, ['a']);
});

test('a request a driver has taken, a pool ride and a ride not yet with the dispatcher are never closed', async () => {
  const h = harness({
    taken: ride('taken', 30, { driverId: 'd1', status: 'assigned' }),
    pool: ride('pool', 30, { pool: { id: 'p1' } }),
    auction: ride('auction', 30, { concierge: false }),
  });
  assert.equal(await h.d.sweepUnserved(T, h.notify), 0);
  assert.deepEqual(h.told, []);
});

test('the rider is told in Amharic and English that nothing was charged', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'ride', 'riderNotify.js'), 'utf8');
  assert.match(src, /cancelledBy === 'nodriver'/);
  assert.match(src, /ሹፌር አልተገኘም/);
  assert.match(src, /nothing was charged/);
});
