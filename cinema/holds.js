'use strict';
// One seat, one row. Holding is an INSERT into SeatHold, which carries @@unique([showId, seat]); the
// second person's insert throws P2002 and they are told "taken". No app-level lock, works across
// processes, and a crash cannot strand a seat because holds carry expiresAt and are swept.
const { isSeat, seatsFor } = require('./seatmap');

const HOLD_MS = 10 * 60 * 1000;
const MAX_SEATS = 8;
const SOLD_STATES = ['RESERVED', 'CONFIRMED', 'CHECKED_IN'];

function makeHolds({ prisma, now }) {
  const clock = now || Date.now;

  async function soldSeats(showId) {
    const ts = await prisma.ticket.findMany({ where: { showId, status: { in: SOLD_STATES } } });
    return new Set(ts.flatMap(t => t.seats || []));
  }

  async function hold(show, seat, holderKey) {
    if (!show || show.status !== 'onsale') return { ok: false, error: 'show_closed' };
    if (!isSeat(show.hall.layout, seat)) return { ok: false, error: 'no_such_seat' };
    if ((await soldSeats(show.id)).has(seat)) return { ok: false, error: 'sold' };
    const t = clock();
    const existing = (await prisma.seatHold.findMany({ where: { showId: show.id, seat } }))[0];
    if (existing) {
      if (existing.expiresAt.getTime() > t) {
        return existing.holderKey === holderKey ? { ok: true, seat, expiresAt: existing.expiresAt, already: true } : { ok: false, error: 'taken' };
      }
      // Expired but not yet swept: clear it so the insert below can win. Someone else may beat us
      // to the insert, and that is fine - the unique guard decides.
      await prisma.seatHold.deleteMany({ where: { showId: show.id, seat, expiresAt: { lt: new Date(t) } } });
    }
    if ((await prisma.seatHold.count({ where: { showId: show.id, holderKey } })) >= MAX_SEATS) return { ok: false, error: 'too_many' };
    const expiresAt = new Date(t + HOLD_MS);
    try {
      await prisma.seatHold.create({ data: { showId: show.id, seat, holderKey, expiresAt } });
      return { ok: true, seat, expiresAt };
    } catch (e) {
      if (e && e.code === 'P2002') return { ok: false, error: 'taken' };
      throw e;
    }
  }

  async function release(showId, holderKey, seats) {
    const where = { showId, holderKey };
    if (seats && seats.length) where.seat = { in: seats };
    return (await prisma.seatHold.deleteMany({ where })).count;
  }

  async function sweep() {
    return (await prisma.seatHold.deleteMany({ where: { expiresAt: { lt: new Date(clock()) } } })).count;
  }

  async function mine(showId, holderKey) {
    const hs = await prisma.seatHold.findMany({ where: { showId, holderKey } });
    return hs.filter(h => h.expiresAt.getTime() > clock());
  }

  // What the map draws: every template seat with a state the client cannot argue with.
  async function availability(show, holderKey) {
    const t = clock();
    const holds = await prisma.seatHold.findMany({ where: { showId: show.id } });
    const heldBy = new Map(holds.filter(h => h.expiresAt.getTime() > t).map(h => [h.seat, h.holderKey]));
    const sold = await soldSeats(show.id);
    return seatsFor(show.hall.layout).map(s => ({ ...s,
      state: s.blocked ? 'blocked' : sold.has(s.id) ? 'sold' : heldBy.has(s.id) ? (heldBy.get(s.id) === holderKey ? 'mine' : 'held') : 'free' }));
  }

  return { hold, release, sweep, mine, availability, soldSeats };
}

module.exports = { makeHolds, HOLD_MS, MAX_SEATS, SOLD_STATES };
