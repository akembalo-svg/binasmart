'use strict';
// One seat, one row. Holding is an INSERT into SeatHold, which carries @@unique([showId, seat]); the
// second person's insert throws P2002 and they are told "taken". No app-level lock, works across
// processes, and a crash cannot strand a seat because holds carry expiresAt and are swept.
// General admission reuses the same guard: a tier's places are synthetic ids ("VIP-001"), and
// holdMany claims the lowest free ones one by one, so the last place can never be sold twice.
const { isSeat, seatsFor, isGa, gaId, gaPrefix } = require('./seatmap');

const HOLD_MS = 10 * 60 * 1000;
const MAX_SEATS = 8;   // chairs per order (seated halls)
const MAX_GA = 10;     // places per order (general admission)
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

  // ---------- general admission ----------
  // Which synthetic ids of a tier are free right now (sold or live-held excluded; stale holds cleared).
  async function gaFree(show, sec, t) {
    const sold = await soldSeats(show.id);
    const holds = await prisma.seatHold.findMany({ where: { showId: show.id } });
    const stale = holds.filter(h => h.expiresAt.getTime() <= t).map(h => h.seat);
    if (stale.length) await prisma.seatHold.deleteMany({ where: { showId: show.id, seat: { in: stale }, expiresAt: { lt: new Date(t) } } });
    const busy = new Set([...sold, ...holds.filter(h => h.expiresAt.getTime() > t).map(h => h.seat)]);
    const free = []; for (let i = 1; i <= sec.capacity; i++) { const id = gaId(sec.name, i); if (!busy.has(id)) free.push(id); }
    return free;
  }

  // Hold `qty` places in a tier. Claims the lowest free ids one by one; each insert is guarded by the
  // unique constraint, so two buyers racing for the last place cannot both win. If we cannot reach
  // qty, our partial claims are rolled back and the caller gets the real number left.
  async function holdMany(show, section, qty, holderKey) {
    if (!show || show.status !== 'onsale') return { ok: false, error: 'show_closed' };
    const L = show.hall.layout;
    if (!isGa(L)) return { ok: false, error: 'not_ga' };
    const sec = (L.sections || []).find(s => s.name === section);
    if (!sec) return { ok: false, error: 'no_such_section' };
    qty = Math.floor(Number(qty)); if (!(qty >= 1)) return { ok: false, error: 'bad_qty' };
    const t = clock();
    const already = (await prisma.seatHold.findMany({ where: { showId: show.id, holderKey } })).filter(h => h.expiresAt.getTime() > t).length;
    if (already + qty > MAX_GA) return { ok: false, error: 'too_many', max: MAX_GA };
    const free = await gaFree(show, sec, t);
    if (free.length < qty) return { ok: false, error: 'sold_out', left: free.length };
    const expiresAt = new Date(t + HOLD_MS); const got = [];
    for (const id of free) {
      if (got.length === qty) break;
      try { await prisma.seatHold.create({ data: { showId: show.id, seat: id, holderKey, expiresAt } }); got.push(id); }
      catch (e) { if (!e || e.code !== 'P2002') throw e; }   // someone else took this one: try the next id
    }
    if (got.length < qty) {
      if (got.length) await prisma.seatHold.deleteMany({ where: { showId: show.id, holderKey, seat: { in: got } } });
      return { ok: false, error: 'sold_out', left: (await gaFree(show, sec, clock())).length };
    }
    return { ok: true, seats: got, expiresAt };
  }

  async function releaseSome(showId, holderKey, section, qty) {
    const p = gaPrefix(section) + '-';
    const mineHere = (await prisma.seatHold.findMany({ where: { showId, holderKey } })).filter(h => h.seat.startsWith(p)).sort((a, b) => (b.seat < a.seat ? -1 : 1));
    const drop = mineHere.slice(0, Math.max(0, Math.floor(Number(qty)) || 0)).map(h => h.seat);
    if (!drop.length) return 0;
    return (await prisma.seatHold.deleteMany({ where: { showId, holderKey, seat: { in: drop } } })).count;
  }

  // Per-tier counts for the picker: capacity, left, mine.
  async function tiers(show, holderKey) {
    const L = show.hall.layout; const t = clock();
    const sold = await soldSeats(show.id);
    const holds = (await prisma.seatHold.findMany({ where: { showId: show.id } })).filter(h => h.expiresAt.getTime() > t);
    return (L.sections || []).map(sec => {
      const p = gaPrefix(sec.name) + '-';
      const soldN = [...sold].filter(id => id.startsWith(p)).length;
      const heldOthers = holds.filter(h => h.seat.startsWith(p) && h.holderKey !== holderKey).length;
      const mineN = holds.filter(h => h.seat.startsWith(p) && h.holderKey === holderKey).length;
      return { name: sec.name, nameAm: sec.nameAm || null, capacity: sec.capacity, left: Math.max(0, sec.capacity - soldN - heldOthers - mineN), mine: mineN };
    });
  }

  return { hold, holdMany, release, releaseSome, sweep, mine, availability, soldSeats, tiers };
}

module.exports = { makeHolds, HOLD_MS, MAX_SEATS, MAX_GA, SOLD_STATES };
