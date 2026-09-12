'use strict';
// The demo timetable must move forward, in whole days, and only for demo operators.
const test = require('node:test');
const assert = require('node:assert');
const { rollDemoTrips, DAY } = require('../../travel/demo-trips');

const isDemo = b => /demo|sample/i.test((b.subCity || '') + ' ' + (b.name || ''));

// A tiny prisma stand-in: two buildings, trips on either.
function world(trips) {
  const buildings = [
    { id: 'demo1', qrSlug: 'bina-travel', name: 'Bina Travel', subCity: 'Demo travel operator — sample data' },
    { id: 'real1', qrSlug: 'selam-bus', name: 'Selam Bus', subCity: 'Mexico' },
  ];
  const rows = trips.map((t, i) => ({ id: 'T' + i, buildingId: t.b, departure: new Date(t.at) }));
  return {
    rows,
    prisma: {
      building: { findMany: async () => buildings },
      travelTrip: {
        findMany: async ({ where }) => rows.filter(r => where.buildingId.in.includes(r.buildingId))
          .map(r => ({ id: r.id, departure: r.departure })),
        update: async ({ where, data }) => { rows.find(r => r.id === where.id).departure = data.departure; },
      },
    },
  };
}

const T = Date.UTC(2026, 8, 12, 5, 0);            // "now" for these tests
const aug19 = Date.UTC(2026, 7, 19, 2, 0);        // the real shape of the seeded data

test('an expired demo timetable is moved into the future', async () => {
  const w = world([{ b: 'demo1', at: aug19 }, { b: 'demo1', at: aug19 + DAY }]);
  const r = await rollDemoTrips(w.prisma, isDemo, () => T);
  assert.equal(r.moved, 2);
  assert.ok(r.days > 0);
  for (const row of w.rows) assert.ok(row.departure.getTime() > T, row.id + ' is still in the past');
});

test('it moves by WHOLE days, so an 05:00 departure stays an 05:00 departure', async () => {
  const w = world([{ b: 'demo1', at: aug19 }]);
  await rollDemoTrips(w.prisma, isDemo, () => T);
  const moved = w.rows[0].departure.getTime();
  assert.equal((moved - aug19) % DAY, 0, 'the shift must be a whole number of days');
  assert.equal(new Date(moved).getUTCHours(), new Date(aug19).getUTCHours());
  assert.equal(new Date(moved).getUTCMinutes(), new Date(aug19).getUTCMinutes());
});

test('the spacing between trips is preserved, not collapsed', async () => {
  const w = world([{ b: 'demo1', at: aug19 }, { b: 'demo1', at: aug19 + 2 * DAY + 3600000 }]);
  await rollDemoTrips(w.prisma, isDemo, () => T);
  const [a, b] = w.rows.map(r => r.departure.getTime());
  assert.equal(b - a, 2 * DAY + 3600000);
});

// Running twice in one day must not push the timetable further and further away.
test('it is idempotent within the day', async () => {
  const w = world([{ b: 'demo1', at: aug19 }]);
  await rollDemoTrips(w.prisma, isDemo, () => T);
  const first = w.rows[0].departure.getTime();
  const again = await rollDemoTrips(w.prisma, isDemo, () => T);
  assert.equal(again.moved, 0);
  assert.equal(again.reason, 'earliest trip is still in the future');
  assert.equal(w.rows[0].departure.getTime(), first);
});

// The whole point of the scoping.
test("a real operator's timetable is never touched, even when it has expired", async () => {
  const w = world([{ b: 'real1', at: aug19 }, { b: 'demo1', at: aug19 }]);
  const r = await rollDemoTrips(w.prisma, isDemo, () => T);
  assert.equal(r.moved, 1, 'only the demo trip moved');
  assert.equal(w.rows.find(x => x.buildingId === 'real1').departure.getTime(), aug19,
    "Selam Bus's departure was rewritten — a real timetable must never be edited by this");
});

test('nothing to do is not an error', async () => {
  const w = world([]);
  const r = await rollDemoTrips(w.prisma, isDemo, () => T);
  assert.equal(r.moved, 0);
  assert.equal(r.reason, 'no demo trips');
});

// The case that made floor+1 the right arithmetic rather than ceil: when the gap is an exact whole
// number of days, ceil lands the earliest departure exactly on now — and /api/travel filters on
// departure > now, so the trip would disappear the instant it was rescued.
test('an exact whole-day gap still lands the trip strictly in the future', async () => {
  const exact = T - 7 * DAY;                      // precisely seven days ago
  const w = world([{ b: 'demo1', at: exact }]);
  const r = await rollDemoTrips(w.prisma, isDemo, () => T);
  assert.equal(r.moved, 1);
  assert.ok(w.rows[0].departure.getTime() > T,
    'landed on ' + new Date(w.rows[0].departure).toISOString() + ', which is not after now');
  assert.equal((w.rows[0].departure.getTime() - exact) % DAY, 0, 'and still a whole number of days');
});
