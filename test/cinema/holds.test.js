'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeHolds, HOLD_MS, MAX_SEATS } = require('../../cinema/holds');

// A fake Prisma that enforces the SAME unique guard as the real SeatHold table (P2002).
// Without that, the race test below would prove nothing.
function fakePrisma() {
  const holds = [], tickets = []; let seq = 0;
  const p2002 = () => Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
  const matchHold = (h, w) => (!w.showId || h.showId === w.showId)
    && (!w.seat || (w.seat.in ? w.seat.in.includes(h.seat) : h.seat === w.seat))
    && (!w.holderKey || h.holderKey === w.holderKey)
    && (!w.expiresAt || h.expiresAt < w.expiresAt.lt);
  return { _: { holds, tickets },
    seatHold: {
      create: async ({ data }) => { if (holds.some(h => h.showId === data.showId && h.seat === data.seat)) throw p2002(); const h = { id: 'h' + (++seq), createdAt: new Date(), ...data }; holds.push(h); return h; },
      deleteMany: async ({ where }) => { let n = 0; for (let i = holds.length - 1; i >= 0; i--) if (matchHold(holds[i], where)) { holds.splice(i, 1); n++; } return { count: n }; },
      findMany: async ({ where }) => holds.filter(h => matchHold(h, where)),
      count: async ({ where }) => holds.filter(h => matchHold(h, where)).length,
    },
    ticket: { findMany: async ({ where }) => tickets.filter(t => t.showId === where.showId && (!where.status || where.status.in.includes(t.status))) },
  };
}
const LAYOUT = { rows: ['A', 'B'], seatsPerRow: 4, sections: [{ name: 'R', rows: ['A', 'B'] }] };
const BIG = { rows: ['A', 'B', 'C'], seatsPerRow: 4, sections: [{ name: 'R', rows: ['A', 'B', 'C'] }] };
const show = { id: 's1', status: 'onsale', hall: { layout: LAYOUT } };

test('holding a free seat succeeds and expires after HOLD_MS', async () => {
  const t = 1_000_000; const prisma = fakePrisma();
  const h = makeHolds({ prisma, now: () => t });
  const r = await h.hold(show, 'A2', 'me');
  assert.equal(r.ok, true); assert.equal(r.expiresAt.getTime(), t + HOLD_MS);
  assert.equal(HOLD_MS, 10 * 60 * 1000);
});
test('two people holding the same seat in the same tick: exactly one wins, the other is told taken', async () => {
  const prisma = fakePrisma(); const h = makeHolds({ prisma, now: () => 1_000_000 });
  const [a, b] = await Promise.all([h.hold(show, 'A2', 'me'), h.hold(show, 'A2', 'you')]);
  assert.equal([a, b].filter(x => x.ok).length, 1);
  assert.equal([a, b].find(x => !x.ok).error, 'taken');
  assert.equal(prisma._.holds.length, 1);
});
test('holding my own held seat again is a no-op success, not "taken"', async () => {
  const prisma = fakePrisma(); const h = makeHolds({ prisma, now: () => 1_000_000 });
  await h.hold(show, 'A2', 'me');
  const r = await h.hold(show, 'A2', 'me');
  assert.equal(r.ok, true); assert.equal(r.already, true); assert.equal(prisma._.holds.length, 1);
});
test('a sold seat cannot be held even after its hold is gone', async () => {
  const prisma = fakePrisma(); prisma._.tickets.push({ showId: 's1', seats: ['A2'], status: 'CONFIRMED' });
  const h = makeHolds({ prisma, now: () => 1 });
  assert.equal((await h.hold(show, 'A2', 'me')).error, 'sold');
});
test('unknown or blocked seats, a closed show, and more than MAX_SEATS are refused', async () => {
  const prisma = fakePrisma(); const h = makeHolds({ prisma, now: () => 1 });
  assert.equal((await h.hold(show, 'Z9', 'me')).error, 'no_such_seat');
  assert.equal((await h.hold({ ...show, hall: { layout: { ...LAYOUT, blocked: ['A1'] } } }, 'A1', 'me')).error, 'no_such_seat');
  assert.equal((await h.hold({ ...show, status: 'cancelled' }, 'A1', 'me')).error, 'show_closed');
  assert.equal((await h.hold(null, 'A1', 'me')).error, 'show_closed');
  const big = { ...show, hall: { layout: BIG } };
  const ids = ['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4'];
  assert.equal(MAX_SEATS, 8);
  for (const id of ids) assert.equal((await h.hold(big, id, 'me')).ok, true);
  assert.equal((await h.hold(big, 'C1', 'me')).error, 'too_many');
});
test('sweep removes only expired holds, and release frees only mine', async () => {
  let t = 1_000_000; const prisma = fakePrisma(); const h = makeHolds({ prisma, now: () => t });
  await h.hold(show, 'A1', 'me'); await h.hold(show, 'A2', 'you');
  t += HOLD_MS + 1; await h.hold(show, 'B1', 'late');           // this one is fresh
  assert.equal(await h.sweep(), 2);
  assert.deepEqual(prisma._.holds.map(x => x.seat), ['B1']);
  assert.equal(await h.release(show.id, 'me'), 0, 'nothing of mine left');
  assert.equal(await h.release(show.id, 'late'), 1);
});
test('an expired hold is invisible before the sweep: the seat is free and someone else can take it', async () => {
  let t = 1_000_000; const prisma = fakePrisma(); const h = makeHolds({ prisma, now: () => t });
  await h.hold(show, 'A1', 'me');
  t += HOLD_MS + 1;
  assert.equal((await h.availability(show, 'you')).find(s => s.id === 'A1').state, 'free');
  assert.deepEqual(await h.mine(show.id, 'me'), []);
  const r = await h.hold(show, 'A1', 'you');
  assert.equal(r.ok, true, 'stale row replaced'); assert.equal(prisma._.holds.length, 1); assert.equal(prisma._.holds[0].holderKey, 'you');
});
test('availability merges holds, tickets and the template for the map', async () => {
  const prisma = fakePrisma(); prisma._.tickets.push({ showId: 's1', seats: ['B4'], status: 'RESERVED' });
  const h = makeHolds({ prisma, now: () => 1 });
  await h.hold(show, 'A1', 'you');
  const m = await h.availability({ ...show, hall: { layout: { ...LAYOUT, blocked: ['A4'] } } }, 'me');
  const st = Object.fromEntries(m.map(s => [s.id, s.state]));
  assert.equal(st.A1, 'held'); assert.equal(st.B4, 'sold'); assert.equal(st.A4, 'blocked'); assert.equal(st.A2, 'free');
  await h.hold(show, 'A3', 'me');
  assert.equal((await h.availability(show, 'me')).find(s => s.id === 'A3').state, 'mine');
});

// ---- general admission ----
const { MAX_GA } = require('../../cinema/holds');
const GA = { kind: 'ga', sections: [{ name: 'VIP', nameAm: 'ቪአይፒ', capacity: 2 }, { name: 'Regular', nameAm: 'መደበኛ', capacity: 12 }] };
const gshow = { id: 'g1', status: 'onsale', hall: { layout: GA } };

test('GA: holdMany takes the lowest free places and reports what is left', async () => {
  const prisma = fakePrisma(); const h = makeHolds({ prisma, now: () => 1_000_000 });
  const r = await h.holdMany(gshow, 'Regular', 3, 'me');
  assert.equal(r.ok, true); assert.deepEqual(r.seats, ['REGULAR-001', 'REGULAR-002', 'REGULAR-003']);
  const t = await h.tiers(gshow, 'me');
  assert.deepEqual(t, [{ name: 'VIP', nameAm: 'ቪአይፒ', capacity: 2, left: 2, mine: 0 }, { name: 'Regular', nameAm: 'መደበኛ', capacity: 12, left: 9, mine: 3 }]);
});
test('GA: asking for more than is left is refused with the real number, nothing partially held', async () => {
  const prisma = fakePrisma(); const h = makeHolds({ prisma, now: () => 1_000_000 });
  await h.holdMany(gshow, 'VIP', 1, 'you');
  const r = await h.holdMany(gshow, 'VIP', 2, 'me');
  assert.equal(r.ok, false); assert.equal(r.error, 'sold_out'); assert.equal(r.left, 1);
  assert.equal(prisma._.holds.filter(x => x.holderKey === 'me').length, 0);
});
test('GA: two buyers race for the last place — one wins, the other is told sold out with 0 left', async () => {
  const prisma = fakePrisma(); const h = makeHolds({ prisma, now: () => 1_000_000 });
  await h.holdMany(gshow, 'VIP', 1, 'early');
  const [a, b] = await Promise.all([h.holdMany(gshow, 'VIP', 1, 'me'), h.holdMany(gshow, 'VIP', 1, 'you')]);
  assert.equal([a, b].filter(x => x.ok).length, 1);
  const loser = [a, b].find(x => !x.ok); assert.equal(loser.error, 'sold_out'); assert.equal(loser.left, 0);
  assert.equal(prisma._.holds.filter(x => x.seat.startsWith('VIP')).length, 2);
});
test('GA: sold places are not free, the cap is MAX_GA, unknown tier / bad qty / seated hall are refused', async () => {
  const prisma = fakePrisma(); prisma._.tickets.push({ showId: 'g1', seats: ['VIP-001', 'VIP-002'], status: 'CONFIRMED' });
  const h = makeHolds({ prisma, now: () => 1 });
  assert.equal((await h.holdMany(gshow, 'VIP', 1, 'me')).error, 'sold_out');
  assert.equal(MAX_GA, 10);
  assert.equal((await h.holdMany(gshow, 'Regular', 11, 'me')).error, 'too_many');
  assert.equal((await h.holdMany(gshow, 'Regular', 10, 'me')).ok, true);
  assert.equal((await h.holdMany(gshow, 'Regular', 1, 'me')).error, 'too_many');
  assert.equal((await h.holdMany(gshow, 'Balcony', 1, 'x')).error, 'no_such_section');
  assert.equal((await h.holdMany(gshow, 'VIP', 0, 'x')).error, 'bad_qty');
  assert.equal((await h.holdMany(show, 'VIP', 1, 'x')).error, 'not_ga');
});
test('GA: releaseSome frees that many of my places in a tier, highest first', async () => {
  const prisma = fakePrisma(); const h = makeHolds({ prisma, now: () => 1 });
  await h.holdMany(gshow, 'Regular', 3, 'me'); await h.holdMany(gshow, 'Regular', 1, 'you');
  assert.equal(await h.releaseSome('g1', 'me', 'Regular', 2), 2);
  assert.deepEqual(prisma._.holds.map(x => x.seat + ':' + x.holderKey), ['REGULAR-001:me', 'REGULAR-004:you']);
  assert.equal(await h.releaseSome('g1', 'me', 'VIP', 5), 0);
});
