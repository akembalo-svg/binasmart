# BinaSmart Events — General Admission (Phase A.5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Concerts, theatre and meetings sell "VIP × 2"-style tickets on `/cinema` with the same holds, QR tickets and door scanner as films, and the old `/events` page is retired.

**Architecture:** A general-admission (GA) hall template `{ kind:'ga', sections:[{ name, nameAm, capacity }] }` is expanded by `cinema/seatmap.js` into synthetic seat ids (`VIP-001 …`). `cinema/holds.js` gains `holdMany(show, section, qty, holder)` which claims the lowest free ids one by one under the existing `SeatHold @@unique([showId, seat])` guard, so overselling is impossible and every downstream step (checkout, ticket, cutoff, door) is untouched. Routes accept `{ section, qty }` next to `{ seat }`; pages render tier cards for GA shows.

**Tech Stack:** as Phase A (Node 22, Fastify 5, Prisma 6, `node --test`). No schema change. MCP server (`mcp-server/`, ESM, pg) gets a new `list_events` query.

**Spec:** `docs/superpowers/specs/2026-09-04-binasmart-events-general-admission-design.md`

---

## File structure

**Modify**
- `cinema/seatmap.js` — GA template: `isGa`, `gaId`, validation, expansion, `summarise`
- `cinema/holds.js` — `holdMany`, `releaseSome`, `tiers`
- `cinema/routes.js` — GA hold/release, tiers in show payload, `ga` flag, `summary` on tickets and check-in, GA hall creation
- `public/cinema/app.js`, `public/cinema/ui.css` — Films/Events groups, tier picker
- `public/ticket.html`, `public/scan.html`, `public/ops-cinema.html` — summary line; GA hall form
- `server.js` — `/events` 301, old API 410, sitemap
- `ride/binaBot.js` — menu + command → `/cinema`
- `mcp-server/tools/directory.mjs`, `mcp-server/test/directory.test.mjs` — `list_events` reads Shows
- `ops/cinema/sim.js`, `ops/cinema/README.md`
- Tests: `test/cinema/seatmap.test.js`, `holds.test.js`, `routes.test.js`

**Create**
- `ops/cinema/retire-old-events.js`

**Delete**
- `public/events.html`

---

### Task 1: GA template in `cinema/seatmap.js`

**Files:** Modify `cinema/seatmap.js`; Test `test/cinema/seatmap.test.js`

- [ ] **Step 1: Append failing tests** to `test/cinema/seatmap.test.js`

```js
const { isGa, gaId, summarise } = require('../../cinema/seatmap');
const GA = { kind: 'ga', sections: [{ name: 'VIP', nameAm: 'ቪአይፒ', capacity: 3 }, { name: 'Regular', nameAm: 'መደበኛ', capacity: 5 }] };

test('GA: template expands into synthetic ids per tier, capacity is the sum', () => {
  assert.equal(isGa(GA), true); assert.equal(isGa(LAYOUT), false);
  const s = seatsFor(GA);
  assert.equal(s.length, 8);
  assert.deepEqual(s[0], { id: 'VIP-001', row: null, n: 1, section: 'VIP', blocked: false, wheelchair: false, aisleAfter: false });
  assert.equal(s[7].id, 'REGULAR-005');
  assert.equal(capacityOf(GA), 8);
  assert.equal(gaId('Front Row!', 12), 'FRONTROW-012');
});
test('GA: isSeat / sectionOf / priceOf work on synthetic ids and refuse the rest', () => {
  assert.equal(isSeat(GA, 'VIP-003'), true); assert.equal(isSeat(GA, 'VIP-004'), false); assert.equal(isSeat(GA, 'VIP-000'), false);
  assert.equal(isSeat(GA, 'A1'), false); assert.equal(isSeat(LAYOUT, 'VIP-001'), false);
  assert.equal(sectionOf(GA, 'REGULAR-002'), 'Regular');
  assert.equal(priceOf(GA, { VIP: 800, Regular: 300 }, 'REGULAR-002'), 300);
});
test('GA: validation', () => {
  assert.equal(validateLayout(GA).ok, true);
  assert.match(validateLayout({ kind: 'ga', sections: [] }).error, /section/);
  assert.match(validateLayout({ kind: 'ga', sections: [{ name: 'VIP', capacity: 0 }] }).error, /capacity/);
  assert.match(validateLayout({ kind: 'ga', sections: [{ name: 'VIP', capacity: 5001 }] }).error, /capacity/);
  assert.match(validateLayout({ kind: 'ga', sections: [{ name: 'VIP', capacity: 1 }, { name: 'vip', capacity: 1 }] }).error, /duplicate/);
  assert.match(validateLayout({ kind: 'ga', sections: Array.from({ length: 21 }, (_, i) => ({ name: 'T' + i, capacity: 1 })) }).error, /20/);
});
test('summarise groups seats by tier in layout order, for GA and seated halls', () => {
  assert.deepEqual(summarise(GA, ['REGULAR-002', 'VIP-001', 'REGULAR-001']), [{ section: 'VIP', nameAm: 'ቪአይፒ', count: 1 }, { section: 'Regular', nameAm: 'መደበኛ', count: 2 }]);
  assert.deepEqual(summarise(LAYOUT, ['B1', 'C2']), [{ section: 'Regular', nameAm: 'መደበኛ', count: 2 }]);
});
```

- [ ] **Step 2: Run** `node --test test/cinema/seatmap.test.js` → 4 new failures (`isGa is not a function`).

- [ ] **Step 3: Implement** — replace the body of `cinema/seatmap.js` with:

```js
'use strict';
// The hall template is the ONLY source of seats. Two kinds:
//   seats: rows × seatsPerRow, ids "C7"           (Phase A)
//   ga:    tiers with capacity, ids "VIP-001"     (general admission: places, not chairs)
// Pure (no DB, no IO).
const MAX_ROWS = 26, MAX_PER_ROW = 40, GA_MAX_SECTIONS = 20, GA_MAX_CAP = 5000;
const ROW_RE = /^[A-Z]{1,2}$/;

const isGa = L => !!(L && L.kind === 'ga');
const gaPrefix = name => String(name || '').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'T';
const gaId = (name, i) => gaPrefix(name) + '-' + String(i).padStart(3, '0');

function validateGa(L) {
  const secs = Array.isArray(L.sections) ? L.sections : [];
  if (!secs.length) return { ok: false, error: 'at least one section (tier)' };
  if (secs.length > GA_MAX_SECTIONS) return { ok: false, error: 'at most ' + GA_MAX_SECTIONS + ' sections' };
  const seen = new Set();
  for (const s of secs) {
    if (!s || !s.name) return { ok: false, error: 'section needs a name' };
    if (!Number.isInteger(s.capacity) || s.capacity < 1 || s.capacity > GA_MAX_CAP) return { ok: false, error: 'capacity for ' + s.name + ' must be 1-' + GA_MAX_CAP };
    const p = gaPrefix(s.name); if (seen.has(p)) return { ok: false, error: 'duplicate section ' + s.name }; seen.add(p);
  }
  return { ok: true };
}

function validateLayout(L) {
  if (!L || typeof L !== 'object') return { ok: false, error: 'layout must be an object' };
  if (isGa(L)) return validateGa(L);
  if (!Array.isArray(L.rows) || !L.rows.length) return { ok: false, error: 'rows must be a non-empty list' };
  if (L.rows.length > MAX_ROWS) return { ok: false, error: 'at most ' + MAX_ROWS + ' rows' };
  if (L.rows.some(r => typeof r !== 'string' || !ROW_RE.test(r))) return { ok: false, error: 'row labels must be A-Z or AA-ZZ' };
  if (!Number.isInteger(L.seatsPerRow) || L.seatsPerRow < 1 || L.seatsPerRow > MAX_PER_ROW) return { ok: false, error: 'seatsPerRow must be 1-' + MAX_PER_ROW };
  if (new Set(L.rows).size !== L.rows.length) return { ok: false, error: 'duplicate row label' };
  for (const k of ['aisles', 'blocked', 'wheelchair']) if (L[k] != null && !Array.isArray(L[k])) return { ok: false, error: k + ' must be a list' };
  const secs = Array.isArray(L.sections) ? L.sections : [];
  if (!secs.length) return { ok: false, error: 'at least one section' };
  const covered = new Map();
  for (const s of secs) {
    if (!s || !s.name) return { ok: false, error: 'section needs a name' };
    for (const r of (s.rows || [])) {
      if (!L.rows.includes(r)) return { ok: false, error: 'section ' + s.name + ' names unknown row ' + r };
      if (covered.has(r)) return { ok: false, error: 'row ' + r + ' is in two sections' };
      covered.set(r, s.name);
    }
  }
  for (const r of L.rows) if (!covered.has(r)) return { ok: false, error: 'row ' + r + ' has no section' };
  return { ok: true };
}

function splitId(id) {
  const m = typeof id === 'string' && id.match(/^([A-Z]{1,2})(\d{1,2})$/);
  return m ? { row: m[1], n: Number(m[2]) } : null;
}
function splitGa(L, id) {
  const m = typeof id === 'string' && id.match(/^([A-Z0-9]+)-(\d{3})$/);
  if (!m) return null;
  const sec = (L.sections || []).find(s => gaPrefix(s.name) === m[1]);
  return sec ? { section: sec, n: Number(m[2]) } : null;
}

function sectionOf(L, seatId) {
  if (isGa(L)) { const p = splitGa(L, seatId); return p ? p.section.name : null; }
  const p = splitId(seatId); if (!p) return null;
  const s = (L.sections || []).find(x => (x.rows || []).includes(p.row));
  return s ? s.name : null;
}

function seatsFor(L) {
  const out = [];
  if (isGa(L)) {
    for (const s of (L.sections || [])) for (let n = 1; n <= s.capacity; n++) out.push({ id: gaId(s.name, n), row: null, n, section: s.name, blocked: false, wheelchair: false, aisleAfter: false });
    return out;
  }
  const aisles = new Set(L.aisles || []), blocked = new Set(L.blocked || []), wc = new Set(L.wheelchair || []);
  for (const row of L.rows) for (let n = 1; n <= L.seatsPerRow; n++) {
    const id = row + n;
    out.push({ id, row, n, section: sectionOf(L, id), blocked: blocked.has(id), wheelchair: wc.has(id), aisleAfter: aisles.has(n) });
  }
  return out;
}

function capacityOf(L) { return seatsFor(L).filter(s => !s.blocked).length; }

function isSeat(L, id) {
  if (isGa(L)) { const p = splitGa(L, id); return !!p && p.n >= 1 && p.n <= p.section.capacity; }
  const p = splitId(id); if (!p) return false;
  if (!L.rows.includes(p.row) || p.n < 1 || p.n > L.seatsPerRow) return false;
  return !(L.blocked || []).includes(id);
}

function priceOf(L, prices, seatId) {
  const sec = sectionOf(L, seatId);
  if (!sec) throw new Error('seat ' + seatId + ' is in no section');
  const p = prices && prices[sec];
  if (!Number.isFinite(p) || p < 0) throw new Error('no price for section ' + sec);
  return p;
}

// [{ section, nameAm, count }] in layout order — "VIP × 2, Regular × 1" for tickets and the door.
function summarise(L, seats) {
  const counts = {};
  for (const id of (seats || [])) { const s = sectionOf(L, id); if (s) counts[s] = (counts[s] || 0) + 1; }
  return (L.sections || []).filter(s => counts[s.name]).map(s => ({ section: s.name, nameAm: s.nameAm || null, count: counts[s.name] }));
}

module.exports = { validateLayout, seatsFor, capacityOf, isSeat, sectionOf, priceOf, isGa, gaId, gaPrefix, summarise, MAX_ROWS, MAX_PER_ROW, GA_MAX_SECTIONS, GA_MAX_CAP };
```

- [ ] **Step 4: Run** → all seatmap tests pass (9). - [ ] **Step 5: Commit** `feat(cinema): general-admission hall template (tiers -> synthetic seats), summarise`

---

### Task 2: `holdMany`, `releaseSome`, `tiers` in `cinema/holds.js`

**Files:** Modify `cinema/holds.js`; Test `test/cinema/holds.test.js`

- [ ] **Step 1: Append failing tests**

```js
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
```

- [ ] **Step 2: Run** → 5 new failures. - [ ] **Step 3: Implement** — in `cinema/holds.js`:

Change the require and constants:
```js
const { isSeat, seatsFor, isGa, gaId, gaPrefix } = require('./seatmap');
const HOLD_MS = 10 * 60 * 1000;
const MAX_SEATS = 8;   // chairs per order (seated halls)
const MAX_GA = 10;     // places per order (general admission)
```
Add inside `makeHolds`, after `mine`:
```js
  // General admission: which synthetic ids of a tier are free right now (sold or live-held excluded).
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
    const mineHere = (await prisma.seatHold.findMany({ where: { showId, holderKey } })).filter(h => h.seat.startsWith(p)).sort((a, b) => b.seat < a.seat ? -1 : 1);
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
      const soldN = [...sold].filter(id => id.startsWith(p)).length, heldOthers = holds.filter(h => h.seat.startsWith(p) && h.holderKey !== holderKey).length, mine = holds.filter(h => h.seat.startsWith(p) && h.holderKey === holderKey).length;
      return { name: sec.name, nameAm: sec.nameAm || null, capacity: sec.capacity, left: Math.max(0, sec.capacity - soldN - heldOthers - mine), mine };
    });
  }
```
Export: `return { hold, holdMany, release, releaseSome, sweep, mine, availability, soldSeats, tiers };` and `module.exports = { makeHolds, HOLD_MS, MAX_SEATS, MAX_GA, SOLD_STATES };`

Note the fake's `deleteMany` already matches `seat.in` + `expiresAt.lt` together, and its `create` throws P2002 on a duplicate — that is what makes the race test real.

- [ ] **Step 4: Run** `node --test test/cinema/holds.test.js` → 13 pass. - [ ] **Step 5: Commit** `feat(cinema): general-admission holds - holdMany under the unique guard, releaseSome, tiers`

---

### Task 3: Routes — GA hold/release, tiers, `ga` flag, summaries, GA hall creation

**Files:** Modify `cinema/routes.js`; Test `test/cinema/routes.test.js`

- [ ] **Step 1: Append failing tests**

```js
const GA = { kind: 'ga', sections: [{ name: 'VIP', nameAm: 'ቪአይፒ', capacity: 2 }, { name: 'Regular', nameAm: 'መደበኛ', capacity: 20 }] };
async function seedGa(f) {
  const v = (await f.inject({ method: 'POST', url: '/api/cinema/ops/venues', headers: OPS, payload: { name: 'Ghion Hall' } })).json();
  const h = (await f.inject({ method: 'POST', url: '/api/cinema/ops/halls', headers: OPS, payload: { venueId: v.venue.id, name: 'Main', layout: GA } })).json();
  assert.equal(h.hall.capacity, 22, JSON.stringify(h));
  const e = (await f.inject({ method: 'POST', url: '/api/cinema/ops/events', headers: OPS, payload: { title: 'Jazz Night', titleAm: 'ጃዝ ምሽት', kind: 'CONCERT' } })).json();
  const s = (await f.inject({ method: 'POST', url: '/api/cinema/ops/shows', headers: OPS, payload: { eventId: e.event.id, hallId: h.hall.id, startsAt: inTwoHours(), prices: { VIP: 800, Regular: 300 } } })).json();
  return { show: s.show, hall: h.hall };
}

test('GA: listing flags ga, the show payload carries tiers, hold by quantity, oversell refused with left', async () => {
  const { f } = await app();
  const { show } = await seedGa(f);
  const list = (await f.inject({ method: 'GET', url: '/api/cinema/shows' })).json();
  assert.equal(list.shows[0].ga, true); assert.equal(list.shows[0].seatsLeft, 22); assert.equal(list.shows[0].event.kind, 'CONCERT');
  const url = '/api/cinema/shows/' + show.id;
  const g = (await f.inject({ method: 'GET', url, headers: H('holder-aaaaaaaa') })).json();
  assert.equal(g.layout.kind, 'ga'); assert.deepEqual(g.tiers.map(t => [t.name, t.price, t.left, t.mine]), [['VIP', 800, 2, 0], ['Regular', 300, 20, 0]]); assert.deepEqual(g.seats, []);
  const h1 = await f.inject({ method: 'POST', url: url + '/hold', headers: H('holder-aaaaaaaa'), payload: { section: 'VIP', qty: 2 } });
  assert.equal(h1.statusCode, 200); assert.deepEqual(h1.json().seats, ['VIP-001', 'VIP-002']);
  const h2 = await f.inject({ method: 'POST', url: url + '/hold', headers: H('holder-bbbbbbbb'), payload: { section: 'VIP', qty: 1 } });
  assert.equal(h2.statusCode, 409); assert.equal(h2.json().error, 'sold_out'); assert.equal(h2.json().left, 0);
  assert.equal((await f.inject({ method: 'POST', url: url + '/hold', headers: H('holder-bbbbbbbb'), payload: { section: 'Balcony', qty: 1 } })).statusCode, 400);
  const g2 = (await f.inject({ method: 'GET', url, headers: H('holder-aaaaaaaa') })).json();
  assert.deepEqual(g2.tiers[0], { name: 'VIP', nameAm: 'ቪአይፒ', price: 800, capacity: 2, left: 0, mine: 2 }); assert.deepEqual(g2.mine, ['VIP-001', 'VIP-002']);
  const rel = await f.inject({ method: 'POST', url: url + '/release', headers: H('holder-aaaaaaaa'), payload: { section: 'VIP', qty: 1 } });
  assert.equal(rel.json().released, 1);
  await f.close();
});

test('GA: checkout prices per place, ticket and door carry a "VIP × 2" summary', async () => {
  const { f } = await app();
  const { show } = await seedGa(f);
  const url = '/api/cinema/shows/' + show.id;
  await f.inject({ method: 'POST', url: url + '/hold', headers: H('holder-aaaaaaaa'), payload: { section: 'VIP', qty: 2 } });
  await f.inject({ method: 'POST', url: url + '/hold', headers: H('holder-aaaaaaaa'), payload: { section: 'Regular', qty: 1 } });
  const r = (await f.inject({ method: 'POST', url: '/api/cinema/tickets', headers: H('holder-aaaaaaaa'), payload: { showId: show.id, seats: ['VIP-001', 'VIP-002', 'REGULAR-001'], name: 'Sara', phone: '0911223344', payMethod: 'counter', idemKey: 'ga-1' } })).json();
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.ticket.total, 1900);
  assert.deepEqual(r.ticket.summary, [{ section: 'VIP', nameAm: 'ቪአይፒ', count: 2 }, { section: 'Regular', nameAm: 'መደበኛ', count: 1 }]);
  const g = (await f.inject({ method: 'GET', url: '/api/cinema/tickets/' + r.ticket.code })).json();
  assert.equal(g.ticket.summary[0].count, 2);
  await f.inject({ method: 'POST', url: '/api/cinema/ops/tickets/' + r.ticket.code + '/paid', headers: OPS, payload: {} });
  const d = (await f.inject({ method: 'POST', url: '/api/cinema/ops/checkin', headers: OPS, payload: { code: r.ticket.code, showId: show.id } })).json();
  assert.equal(d.ok, true); assert.deepEqual(d.ticket.summary.map(x => x.count), [2, 1]); assert.deepEqual(d.counts, { sold: 3, checkedIn: 3 });
  const list = (await f.inject({ method: 'GET', url: '/api/cinema/shows' })).json();
  assert.equal(list.shows[0].seatsLeft, 19);
  await f.close();
});
```

- [ ] **Step 2: Run** → 2 failures. - [ ] **Step 3: Implement** in `cinema/routes.js`:

Require line: `const { validateLayout, capacityOf, isGa, summarise } = require('./seatmap');` and `const { HOLD_MS, MAX_SEATS, MAX_GA, SOLD_STATES } = require('./holds');`

`ERR_CODE` gains `sold_out: 409, no_such_section: 400, not_ga: 400, bad_qty: 400`.

`pubShow(s)` gains `ga: isGa(h.layout || {})` next to `hall`.

`pubTicket(t, show)`:
```js
function pubTicket(t, show) {
  const sh = t.show || show || null;
  const L = sh && sh.hall && sh.hall.layout;
  return { code: t.code, status: t.status, seats: t.seats, summary: L ? summarise(L, t.seats) : null, name: t.name, phone: t.phone, total: t.total, payMethod: t.payMethod,
    chapaPending: t.payMethod === 'chapa' && t.status === 'RESERVED', createdAt: t.createdAt, checkedInAt: t.checkedInAt, show: sh ? pubShow(sh) : null };
}
```
Show payload (`GET /api/cinema/shows/:id`): after `const holder = holderOf(req);`
```js
    const ga = isGa(show.hall.layout);
    const seats = ga ? [] : await holds.availability(show, holder);
    const tiers = ga ? (await holds.tiers(show, holder)).map(t => ({ ...t, price: Number((show.prices || {})[t.name]) })) : null;
    const mine = holder ? await holds.mine(show.id, holder) : [];
    return { ok: true, show: pubShow(show), layout: show.hall.layout, seats, tiers, holdMs: HOLD_MS, maxSeats: ga ? MAX_GA : MAX_SEATS, ... (rest unchanged)
```
Hold route body after loading the show:
```js
    const b = req.body || {};
    const r = b.section != null ? await holds.holdMany(show, String(b.section), b.qty, holder) : await holds.hold(show, String(b.seat || ''), holder);
    return r.ok ? r : fail(reply, r);
```
Release route:
```js
    const b = req.body || {};
    if (b.section != null) return { ok: true, released: await holds.releaseSome(String(req.params.id), holder, String(b.section), b.qty) };
    const seats = Array.isArray(b.seats) ? b.seats.map(String).slice(0, MAX_GA) : null;
    return { ok: true, released: await holds.release(String(req.params.id), holder, seats) };
```
Ops halls: replace the `clean` construction with
```js
    const clean = isGa(layout)
      ? { kind: 'ga', sections: layout.sections.map(s => ({ name: String(s.name).slice(0, 30), nameAm: s.nameAm ? String(s.nameAm).slice(0, 30) : null, capacity: s.capacity })) }
      : { kind: 'seats', rows: layout.rows, seatsPerRow: layout.seatsPerRow, aisles: (layout.aisles || []).map(Number).filter(Number.isInteger), blocked: (layout.blocked || []).map(String), wheelchair: (layout.wheelchair || []).map(String), sections: layout.sections.map(s => ({ name: String(s.name).slice(0, 30), nameAm: s.nameAm ? String(s.nameAm).slice(0, 30) : null, rows: s.rows })) };
```
Ops ticket list: `tickets: ts.map(t => ({ ...pubTicket(t, show), telegram: !!t.telegramId, chapaRef: t.chapaRef }))`. Check-in: `checkin.scan` already includes `show.hall`, so `pubTicket(r.ticket)` summarises.

- [ ] **Step 4: Run** `node --test test/cinema/*.test.js` → all pass. - [ ] **Step 5: Commit** `feat(cinema): general-admission API - hold by quantity, tiers, summaries`

---

### Task 4: Pages — Films/Events groups, tier picker, summaries, GA hall form

**Files:** Modify `public/cinema/app.js`, `public/cinema/ui.css`, `public/cinema.html` (bump `?v=`), `public/ticket.html`, `public/scan.html`, `public/ops-cinema.html`

- [ ] **Step 1: Listing** — in `renderList`, split `order` into films (`ev.kind === 'FILM'`) and events; render `<h2>🎬 ፊልሞች · Films</h2>` cards then `<h2>🎟️ ዝግጅቶች · Events</h2>` cards (event cards show `fmtDay + fmtTime` big, `from` price, and `seatsLeft` "N ቀርተዋል" when ≤ 20). Skip a heading whose group is empty.

- [ ] **Step 2: Tier picker** — in `renderShow`, when `S.layout.kind === 'ga'` render instead of the map:
```js
'<div id="tiers"></div>'
```
and add `paintTiers()`:
```js
  function paintTiers() {
    var box = $('tiers'); if (!box || !S.tiers) return;
    box.innerHTML = S.tiers.map(function (t) {
      var out = t.left === 0 && t.mine === 0;
      return '<div class="tier card' + (out ? ' out' : '') + '"><div class="ti"><div class="tn">' + esc(t.nameAm || t.name) + (t.nameAm ? ' <small>' + esc(t.name) + '</small>' : '') + '</div><div class="tp">' + birr(t.price) + '</div><div class="tl">' + (out ? 'ተሽጦ አልቋል · sold out' : t.left + ' ቀርተዋል · left') + '</div></div>'
        + '<div class="step"><button type="button" data-t="' + esc(t.name) + '" data-d="-1"' + (t.mine ? '' : ' disabled') + '>−</button><b>' + t.mine + '</b><button type="button" data-t="' + esc(t.name) + '" data-d="1"' + (t.left ? '' : ' disabled') + '>+</button></div></div>';
    }).join('');
  }
```
`load()` stores `S.tiers = j.tiers`; `renderShow` calls `paintTiers()` for GA and `paintSeats()` otherwise; the poll refresh does the same. Click handler `onTierTap(ev)`: button with `data-t` → `d === '1'` ? `api(hold, { section, qty: 1 })` : `api(release, { section, qty: 1 })`; on `sold_out` toast `T.sold_out` (add `sold_out: 'ተሽጦ አልቋል · Sold out — only {n} left'` with `{n}` replaced) then `load(S.show.id, true)`. On success set `S.mine` from the refreshed payload (`load(S.show.id, true)`), and `S.expiresAt` from `j.expiresAt` when the first hold lands.
Bottom bar for GA: `barSeats` shows `S.tiers.filter(t => t.mine).map(t => (t.nameAm || t.name) + ' × ' + t.mine).join(' · ')`; total = Σ `mine × price`. Checkout sends `seats: S.mine` (the synthetic ids the server gave us — `j.mine` from the show payload), unchanged API.
CSS (`ui.css`): `.tier{display:flex;align-items:center;gap:12px;margin-bottom:10px}.tier.out{opacity:.5}.ti{flex:1}.tn{font-weight:900;font-size:16px}.tn small{color:var(--mute);font-weight:700;font-size:12px}.tp{color:var(--brand);font-weight:900}.tl{font-size:12px;color:var(--mute)}.step{display:flex;align-items:center;gap:10px}.step button{width:40px;height:40px;border-radius:12px;border:1.5px solid var(--line);background:#fff;font-size:22px;font-weight:900;cursor:pointer}.step button:disabled{opacity:.35}.step b{min-width:22px;text-align:center;font-size:18px}`.

- [ ] **Step 3: Ticket and door** — `ticket.html`: seats line becomes `t.summary && t.summary.length && t.show.hall && !/^[A-Z]{1,2}\d/.test(t.seats[0]) ? summary.map(s => (s.nameAm||s.section) + ' × ' + s.count).join(' · ') : seats.join(' · ')`; simpler rule: if `t.show && t.show.ga` show the summary, else the chair ids (`pubShow` now carries `ga`). `scan.html`: same rule on `tk.show.ga` for the big seats line.

- [ ] **Step 4: Ops hall form** — add `<label><input type="checkbox" id="hGa"> General admission (tiers, no seat map)</label>` and a `#gaTiers` block with rows `name / Amharic / capacity` and an "+ tier" button; `layoutFromForm()` returns `{ kind:'ga', sections:[...] }` when `#hGa` is checked (capacity as integer); `preview()` for GA prints "VIP 50 · Regular 200 · capacity 250". The show form's prices come from `hall.layout.sections` already, so nothing changes there.

- [ ] **Step 5: Verify live** — run `ops/cinema/demo.js` (Task 6 adds a GA show to it), open `/cinema` and the GA show at 390 px in the browser pane: tiers render, + holds, − releases, sold-out state, checkout → ticket shows "ቪአይፒ × 2". Screenshot.

- [ ] **Step 6: Commit** `feat(cinema): Films/Events listing, tier picker for general admission, summaries on ticket and door, GA hall form`

---

### Task 5: Retire the old events page

**Files:** Modify `server.js`, `ride/binaBot.js`, `mcp-server/tools/directory.mjs`, `mcp-server/test/directory.test.mjs`; Create `ops/cinema/retire-old-events.js`; Delete `public/events.html`

- [ ] **Step 1: Failing route test** (append to `test/cinema/routes.test.js` — these routes live in server.js, so test them live in the sim instead; here only assert the cinema module does not claim `/events`): skip — covered by Step 5's curl checks and the sim.

- [ ] **Step 2: server.js** (python patch, exact anchors):
  - `fastify.get('/events', async (req, reply) => reply.sendFile('events.html'));` → `fastify.get('/events', async (req, reply) => reply.redirect('/cinema', 301));`
  - The `fastify.get('/api/events', …)` handler body → `async (req, reply) => reply.code(410).send({ ok: false, error: 'moved', url: '/cinema', api: '/api/cinema/shows' })`.
  - The `fastify.post('/api/events/:slug/book', …)` handler body → `async (req, reply) => reply.code(410).send({ ok: false, error: 'moved', url: '/cinema' })`.
  - Remove `'https://bina.et/events', ` from the sitemap list.
  - `tierAvailability` becomes unused: delete the function (lines 458–463).
- [ ] **Step 3: Bot** — `ride/binaBot.js`: `{ text: '🎟 Events · ዝግጅቶች', path: '/events' }` → `path: '/cinema'`; `events: '/events'` → `events: '/cinema'`.
- [ ] **Step 4: MCP `list_events`** — `mcp-server/tools/directory.mjs` `SQL.events` becomes:
```js
  events: `SELECT s.id, s."startsAt", s.prices, e.slug, e.title, e."titleAm", e.kind, e.descr, e."runtimeMin", h.name AS hall, h.capacity, h.layout,
                  v.name AS venue, v."nameAm" AS "venueAm", v.address,
                  COALESCE((SELECT SUM(cardinality(t.seats)) FROM "Ticket" t WHERE t."showId" = s.id AND t.status IN ('RESERVED','CONFIRMED','CHECKED_IN')), 0)::int AS sold
           FROM "Show" s JOIN "Event" e ON e.id = s."eventId" JOIN "Hall" h ON h.id = s."hallId" JOIN "Venue" v ON v.id = h."venueId"
           WHERE s.status = 'onsale' AND s."startsAt" > now() ORDER BY s."startsAt" LIMIT 50`,
```
and the tool maps rows to:
```js
    const events = rows.map(s => {
      const prices = s.prices && typeof s.prices === 'object' ? s.prices : {};
      const vals = Object.values(prices).map(Number).filter(Number.isFinite);
      return { show_id: s.id, slug: s.slug, title: s.title, title_am: s.titleAm || undefined, kind: s.kind, venue: s.venue, venue_am: s.venueAm || undefined, address: s.address || undefined, hall: s.hall,
        description: s.descr || undefined, starts_at: s.startsAt, runtime_min: s.runtimeMin || undefined, general_admission: !!(s.layout && s.layout.kind === 'ga'),
        price_from_etb: vals.length ? Math.min(...vals) : undefined, prices_etb: prices, seats_left: Math.max(0, (s.capacity || 0) - (s.sold || 0)), url: `${BASE}/cinema/${s.id}` };
    });
    return json({ count: events.length, events, book_hint: 'Seats are chosen and paid on the url (Chapa or at the counter); the ticket is a QR code.', source_url: `${BASE}/cinema` });
```
Description string: `'Upcoming films, concerts, theatre and events on BinaSmart in Addis Ababa with venue, hall, start time, prices per tier and seats left. Seats are booked at the url returned.'`
Test (`mcp-server/test/directory.test.mjs`, replace the `list_events` test):
```js
test('list_events reads shows on sale: price_from, seats_left, url per show', async () => {
  const db = fakeDb(sql => /FROM "Show"/.test(sql)
    ? [{ id: 'sh1', slug: 'jazz', title: 'Jazz Night', titleAm: null, kind: 'CONCERT', venue: 'Skylight', venueAm: null, address: 'Bole', hall: 'Main', capacity: 250, layout: { kind: 'ga' }, startsAt: '2026-10-01T18:00:00Z', prices: { VIP: 1500, Regular: 500 }, sold: 10, descr: null, runtimeMin: null }]
    : []);
  const r = out(await tools(db).list_events({}));
  assert.equal(r.events[0].price_from_etb, 500);
  assert.equal(r.events[0].seats_left, 240);
  assert.equal(r.events[0].general_admission, true);
  assert.equal(r.events[0].url, 'https://bina.et/cinema/sh1');
});
```
Run `cd mcp-server && npm test` → green; `pm2 restart bina-mcp`.
- [ ] **Step 5: Data + file** — `ops/cinema/retire-old-events.js`:
```js
'use strict';
// Removes the pre-cinema demo Events (those with no Show) and their EventTickets. Prints what it removed.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const old = await prisma.event.findMany({ where: { shows: { none: {} } }, select: { id: true, title: true, slug: true } });
  const tickets = await prisma.eventTicket.deleteMany({ where: { eventId: { in: old.map(e => e.id) } } });
  const events = await prisma.event.deleteMany({ where: { id: { in: old.map(e => e.id) } } });
  console.log('removed', events.count, 'old events,', tickets.count, 'old tickets:', old.map(e => e.slug).join(', ') || '—');
  await prisma.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
```
Run it; `git rm public/events.html`.
- [ ] **Step 6: Verify live** — `curl -sI https://bina.et/events | head -3` → `301` + `location: /cinema`; `curl -s https://bina.et/api/events` → 410 JSON; sitemap has no `/events`; `npm test` green; bot menu points to `/cinema` (unit test `test/binaBot.test.js` if it asserts paths — update it).
- [ ] **Step 7: Commit** `feat(cinema): retire /events (301), old booking API 410, MCP list_events reads shows, demo events removed`

---

### Task 6: Sim, demo, README

**Files:** Modify `ops/cinema/sim.js`, `ops/cinema/demo.js`, `ops/cinema/README.md`

- [ ] **Step 1: Sim** — append a GA block before cleanup (GA hall `{ kind:'ga', sections:[{ name:'VIP', capacity:2 }, { name:'Regular', capacity:5 }] }`, show, `Promise.all` of two `hold { section:'VIP', qty:2 }` → one 200 one 409 `sold_out`, oversell `qty:9` Regular → 409 with `left:5`, checkout 2 VIP + 1 Regular → total from prices, ticket `summary` `[2,1]`, paid → checkin 200 with summary, `/events` → 301, `/api/events` → 410). Add the new show/hall ids to `ids` so cleanup removes them.
- [ ] **Step 2: Demo** — `demo.js` also creates a GA event ("Demo Concert (test)", kind CONCERT, tiers VIP 20 / Regular 100, prices 800/300, tomorrow 19:00) so the Events group and the tier picker can be seen; `--clean` already removes everything under the demo slug prefix.
- [ ] **Step 3: README** — add the GA paragraph (tiers, cap 10, ids `VIP-001`) and the `/events` retirement.
- [ ] **Step 4: Run** `node ops/cinema/sim.js` → `ALL N CHECKS PASSED`, leftovers 0. `npm test` green. Commit `test(cinema): general-admission flow in the live sim; demo concert; README` and push.

---

## Self-review

- **Spec coverage:** §2–3 template → T1; §4 API → T2/T3; §5 pages → T4; §6 retire → T5; §7 errors → T2/T3 (`sold_out` with `left`, `too_many` cap 10, `no_such_section`); §8 tests → T1–T3 unit, T6 sim; §9 rollout → T6.
- **Names:** `holdMany/releaseSome/tiers`, `isGa/gaId/gaPrefix/summarise`, `MAX_GA`, payload fields `section/qty`, response `tiers[{name,nameAm,price,capacity,left,mine}]`, `ticket.summary[{section,nameAm,count}]`, `show.ga` — used consistently in T2, T3, T4, T5.
- **No placeholders:** T4 steps name the exact elements and functions; T5 step 1 explicitly defers server.js route tests to the live sim because those routes are outside the cinema module.
