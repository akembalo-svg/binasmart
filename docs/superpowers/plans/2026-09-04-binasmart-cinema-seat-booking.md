# BinaSmart Cinema Seat Booking (Phase A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A customer opens `bina.et/cinema`, picks a show, taps exact seats on a live map, and gets a QR ticket — paid on Chapa (test) or reserved to pay at the counter — with a door scanner that admits each ticket once. Two people can never buy the same chair.

**Architecture:** A self-contained `cinema/` module mounted into `server.js` exactly like `ride/` (`registerCinema(fastify, deps)`), behind `CINEMA_ENABLED=1`. Seat exclusivity is a database unique constraint (`SeatHold @@unique([showId, seat])`): holding is an INSERT, so the second person's insert fails — the same first-wins guard the ride auction uses. Prices are computed server-side from `Show.prices`; the client is never trusted. Static pages in `public/` in the light, Amharic-first style of `/why-binasmart`.

**Tech Stack:** Node 22, Fastify 5, Prisma 6 / PostgreSQL, `node --test`, `qrcode` (pure JS, SVG output), Telegram delivery via the existing `ride/telegram.js` `deliver()`, Chapa helpers already in `server.js`. Spec: `docs/superpowers/specs/2026-09-04-binasmart-cinema-seat-booking-design.md`.

**Assumptions (Ibrahim has not yet answered the spec's three questions):** the first venue is seeded from a script he edits (`ops/cinema/seed-first-venue.js`); the counter-payment cutoff is a per-Show field `counterCutoffMin` defaulting to 30; the scanner is owner-key only, with `Venue.scanKey` reserved but unused.

**Conventions (from the repo):** owner auth is `req.query.key || req.headers['x-owner-key']` === `OWNER_KEY`; Ethiopian phones via `ride/phone.js` `normPhone`; tests use `node --test` with hand-rolled fake Prisma that enforces the same guards as the real one; nothing is ever sent to Telegram from a test — stub the bot. Patch files with a temp-file-then-rename pattern (a failed in-place write once emptied `drive.js`).

---

## File structure

**Create**
- `cinema/seatmap.js` — hall template → seat list, validation, section/price lookup
- `cinema/holds.js` — hold / release / sweep, backed by the unique constraint
- `cinema/tickets.js` — checkout transaction, ticket code, QR SVG, cancel, counter-release sweep
- `cinema/checkin.js` — door state machine
- `cinema/routes.js` — public + ops HTTP API
- `cinema/index.js` — `registerCinema(fastify, deps)`, timers
- `public/cinema.html`, `public/cinema/app.js`, `public/cinema/ui.css` — listing, seat map, checkout
- `public/ticket.html` — QR ticket page
- `public/scan.html` — door scanner
- `public/ops-cinema.html` — venue/hall/event/show admin
- `test/cinema/seatmap.test.js`, `holds.test.js`, `tickets.test.js`, `checkin.test.js`, `routes.test.js`
- `ops/cinema/sim.js` — end-to-end against live Postgres, Telegram stubbed
- `ops/cinema/seed-first-venue.js`
- `ops/cinema/README.md`

**Modify**
- `prisma/schema.prisma` — new models + Event fields
- `server.js` — mount, sitemap entries
- `ops/health/check.js` — add `/cinema` page check
- `.env.example` — `CINEMA_ENABLED`

---

### Task 1: Schema

**Files:** Modify `prisma/schema.prisma`; Test: `test/cinema/schema.test.js`

- [ ] **Step 1: Write the failing test** — it reads the schema text and asserts the models exist with the guarantees the design depends on.

```js
// test/cinema/schema.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const schema = fs.readFileSync(path.join(__dirname, '..', '..', 'prisma', 'schema.prisma'), 'utf8');
const model = name => (schema.match(new RegExp('model ' + name + ' \\{[\\s\\S]*?\\n\\}')) || [''])[0];

test('cinema models exist', () => {
  for (const m of ['Venue', 'Hall', 'Show', 'SeatHold', 'Ticket']) assert.ok(model(m), m + ' missing');
});
test('a seat can be held by at most one person per show — enforced by the database, not the app', () => {
  assert.match(model('SeatHold'), /@@unique\(\[showId, seat\]\)/);
  assert.match(model('SeatHold'), /expiresAt\s+DateTime/);
});
test('tickets carry their seats, a unique code and a status', () => {
  const t = model('Ticket');
  assert.match(t, /code\s+String\s+@unique/);
  assert.match(t, /seats\s+String\[\]/);
  assert.match(t, /status\s+String\s+@default\("RESERVED"\)/);
  assert.match(t, /counterCutoffMin|payMethod/);
});
test('Event gained the film fields and Show links Event to Hall with prices per section', () => {
  assert.match(model('Event'), /posterUrl\s+String\?/);
  assert.match(model('Show'), /prices\s+Json/);
  assert.match(model('Show'), /counterCutoffMin\s+Int\s+@default\(30\)/);
});
```

- [ ] **Step 2: Run it to see it fail** — `node --test test/cinema/schema.test.js` → 4 failures, "Venue missing".

- [ ] **Step 3: Add the models** (append to `prisma/schema.prisma`; add the four Event fields inside the existing `model Event`).

```prisma
model Event {
  // ...existing fields unchanged...
  kind        String   @default("FILM")   // FILM | CONCERT | THEATER | MEETUP | OTHER
  posterUrl   String?
  runtimeMin  Int?
  rating      String?                     // "PG-13", "18+"
  language    String?                     // "Amharic", "English (Amharic subtitles)"
  shows       Show[]
}

model Venue {
  id        String   @id @default(cuid())
  slug      String   @unique
  name      String
  nameAm    String?
  address   String?
  lat       Float?
  lng       Float?
  phone     String?
  scanKey   String?   // reserved for per-venue door staff (Phase C)
  active    Boolean   @default(true)
  halls     Hall[]
  createdAt DateTime  @default(now())
}

model Hall {
  id        String   @id @default(cuid())
  venueId   String
  venue     Venue    @relation(fields: [venueId], references: [id])
  name      String
  layout    Json     // { rows, seatsPerRow, aisles, blocked, wheelchair, sections }
  capacity  Int
  shows     Show[]
}

model Show {
  id               String    @id @default(cuid())
  eventId          String
  event            Event     @relation(fields: [eventId], references: [id])
  hallId           String
  hall             Hall      @relation(fields: [hallId], references: [id])
  startsAt         DateTime
  prices           Json      // { "VIP": 500, "Regular": 300 }
  status           String    @default("onsale")   // onsale | soldout | cancelled | closed
  counterCutoffMin Int       @default(30)
  holds            SeatHold[]
  tickets          Ticket[]
  @@index([startsAt])
  @@index([status])
}

model SeatHold {
  id        String   @id @default(cuid())
  showId    String
  show      Show     @relation(fields: [showId], references: [id])
  seat      String
  holderKey String
  expiresAt DateTime
  createdAt DateTime @default(now())
  @@unique([showId, seat])
  @@index([expiresAt])
  @@index([holderKey])
}

model Ticket {
  id          String    @id @default(cuid())
  code        String    @unique
  showId      String
  show        Show      @relation(fields: [showId], references: [id])
  seats       String[]
  name        String
  phone       String
  telegramId  String?
  total       Int
  status      String    @default("RESERVED")   // RESERVED | CONFIRMED | CHECKED_IN | CANCELLED
  payMethod   String    @default("counter")    // counter | chapa
  chapaRef    String?
  idemKey     String?   @unique
  checkedInAt DateTime?
  createdAt   DateTime  @default(now())
  @@index([showId, status])
  @@index([phone])
}
```

- [ ] **Step 4: Push and generate** — `cp prisma/schema.prisma /root/storage/schema.prisma.bak-cinema-$(date +%s) && npx prisma db push && npx prisma generate`. Expected: "Your database is now in sync". Then `node --test test/cinema/schema.test.js` → 4 pass.

- [ ] **Step 5: Commit** — `git add prisma/schema.prisma test/cinema/schema.test.js && git commit -m "feat(cinema): schema - venues, halls, shows, seat holds with a per-seat unique guard, tickets"`

---

### Task 2: `cinema/seatmap.js` — the hall template

**Files:** Create `cinema/seatmap.js`; Test `test/cinema/seatmap.test.js`

- [ ] **Step 1: Failing tests**

```js
// test/cinema/seatmap.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { seatsFor, validateLayout, sectionOf, priceOf, capacityOf } = require('../../cinema/seatmap');

const LAYOUT = { rows: ['A', 'B', 'C'], seatsPerRow: 6, aisles: [3], blocked: ['A1'], wheelchair: ['C6'],
  sections: [{ name: 'VIP', nameAm: 'ቪአይፒ', rows: ['A'] }, { name: 'Regular', nameAm: 'መደበኛ', rows: ['B', 'C'] }] };

test('seatsFor expands the template into concrete seats with section and flags', () => {
  const s = seatsFor(LAYOUT);
  assert.equal(s.length, 18);
  assert.deepEqual(s[0], { id: 'A1', row: 'A', n: 1, section: 'VIP', blocked: true, wheelchair: false, aisleAfter: false });
  assert.equal(s.find(x => x.id === 'A3').aisleAfter, true, 'gap after seat 3');
  assert.equal(s.find(x => x.id === 'C6').wheelchair, true);
});
test('capacity excludes blocked seats', () => { assert.equal(capacityOf(LAYOUT), 17); });
test('sectionOf and priceOf come from the layout and the show, never the client', () => {
  assert.equal(sectionOf(LAYOUT, 'B4'), 'Regular');
  assert.equal(priceOf(LAYOUT, { VIP: 500, Regular: 300 }, 'A2'), 500);
  assert.equal(priceOf(LAYOUT, { VIP: 500, Regular: 300 }, 'C1'), 300);
  assert.throws(() => priceOf(LAYOUT, { VIP: 500 }, 'C1'), /no price for section Regular/);
});
test('validateLayout rejects what the ops form must not accept', () => {
  assert.equal(validateLayout(LAYOUT).ok, true);
  assert.match(validateLayout({ ...LAYOUT, rows: [] }).error, /rows/);
  assert.match(validateLayout({ ...LAYOUT, seatsPerRow: 0 }).error, /seatsPerRow/);
  assert.match(validateLayout({ ...LAYOUT, sections: [{ name: 'VIP', rows: ['Z'] }] }).error, /unknown row Z/);
  assert.match(validateLayout({ ...LAYOUT, sections: [{ name: 'VIP', rows: ['A'] }] }).error, /row B has no section/);
  assert.match(validateLayout({ ...LAYOUT, rows: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'AA'] }).error, /26 rows/);
});
test('isSeat only accepts ids the template actually contains', () => {
  const { isSeat } = require('../../cinema/seatmap');
  assert.equal(isSeat(LAYOUT, 'B4'), true);
  assert.equal(isSeat(LAYOUT, 'A1'), false, 'blocked is not bookable');
  assert.equal(isSeat(LAYOUT, 'D1'), false);
  assert.equal(isSeat(LAYOUT, 'B0'), false);
});
```

- [ ] **Step 2: Run** → fails, module not found.

- [ ] **Step 3: Implement**

```js
// cinema/seatmap.js
'use strict';
// The hall template is the ONLY source of seats. The server expands it; the client draws it; nobody
// invents a seat id. Keeping this pure (no DB, no IO) is what makes it trivially testable.
const MAX_ROWS = 26, MAX_PER_ROW = 40;

function validateLayout(L) {
  if (!L || typeof L !== 'object') return { ok: false, error: 'layout must be an object' };
  if (!Array.isArray(L.rows) || !L.rows.length) return { ok: false, error: 'rows must be a non-empty list' };
  if (L.rows.length > MAX_ROWS) return { ok: false, error: 'at most ' + MAX_ROWS + ' rows' };
  if (!Number.isInteger(L.seatsPerRow) || L.seatsPerRow < 1 || L.seatsPerRow > MAX_PER_ROW) return { ok: false, error: 'seatsPerRow must be 1-' + MAX_PER_ROW };
  if (new Set(L.rows).size !== L.rows.length) return { ok: false, error: 'duplicate row label' };
  const secs = Array.isArray(L.sections) ? L.sections : [];
  if (!secs.length) return { ok: false, error: 'at least one section' };
  const covered = new Map();
  for (const s of secs) {
    if (!s.name) return { ok: false, error: 'section needs a name' };
    for (const r of (s.rows || [])) {
      if (!L.rows.includes(r)) return { ok: false, error: 'section ' + s.name + ' names unknown row ' + r };
      if (covered.has(r)) return { ok: false, error: 'row ' + r + ' is in two sections' };
      covered.set(r, s.name);
    }
  }
  for (const r of L.rows) if (!covered.has(r)) return { ok: false, error: 'row ' + r + ' has no section' };
  for (const k of ['aisles', 'blocked', 'wheelchair']) if (L[k] != null && !Array.isArray(L[k])) return { ok: false, error: k + ' must be a list' };
  return { ok: true };
}

function sectionOf(L, seatId) {
  const row = seatId.replace(/\d+$/, '');
  const s = (L.sections || []).find(x => (x.rows || []).includes(row));
  return s ? s.name : null;
}

function seatsFor(L) {
  const aisles = new Set(L.aisles || []), blocked = new Set(L.blocked || []), wc = new Set(L.wheelchair || []);
  const out = [];
  for (const row of L.rows) for (let n = 1; n <= L.seatsPerRow; n++) {
    const id = row + n;
    out.push({ id, row, n, section: sectionOf(L, id), blocked: blocked.has(id), wheelchair: wc.has(id), aisleAfter: aisles.has(n) });
  }
  return out;
}

function capacityOf(L) { return seatsFor(L).filter(s => !s.blocked).length; }

function isSeat(L, id) {
  if (typeof id !== 'string' || !/^[A-Z]{1,2}\d{1,2}$/.test(id)) return false;
  const row = id.replace(/\d+$/, ''), n = Number(id.slice(row.length));
  if (!L.rows.includes(row) || n < 1 || n > L.seatsPerRow) return false;
  return !(L.blocked || []).includes(id);
}

function priceOf(L, prices, seatId) {
  const sec = sectionOf(L, seatId);
  if (!sec) throw new Error('seat ' + seatId + ' is in no section');
  const p = prices && prices[sec];
  if (!Number.isFinite(p) || p < 0) throw new Error('no price for section ' + sec);
  return p;
}

module.exports = { validateLayout, seatsFor, capacityOf, isSeat, sectionOf, priceOf, MAX_ROWS, MAX_PER_ROW };
```

- [ ] **Step 4: Run** → 5 pass. - [ ] **Step 5: Commit** `feat(cinema): hall template -> seats, validation, section prices`

---

### Task 3: `cinema/holds.js` — the mutex

**Files:** Create `cinema/holds.js`; Test `test/cinema/holds.test.js`

The fake Prisma in the test must reject a second `seatHold.create` for the same `(showId, seat)` with an error whose `code` is `P2002`, exactly as the real one does. That is what makes the race test meaningful.

- [ ] **Step 1: Failing tests**

```js
// test/cinema/holds.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeHolds, HOLD_MS, MAX_SEATS } = require('../../cinema/holds');

function fakePrisma() {
  const holds = [], tickets = [];
  let seq = 0;
  const p2002 = () => Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
  return { _: { holds, tickets },
    seatHold: {
      create: async ({ data }) => { if (holds.some(h => h.showId === data.showId && h.seat === data.seat)) throw p2002(); const h = { id: 'h' + (++seq), createdAt: new Date(), ...data }; holds.push(h); return h; },
      deleteMany: async ({ where }) => { let n = 0; for (let i = holds.length - 1; i >= 0; i--) { const h = holds[i]; if ((!where.showId || h.showId === where.showId) && (!where.seat || (where.seat.in ? where.seat.in.includes(h.seat) : h.seat === where.seat)) && (!where.holderKey || h.holderKey === where.holderKey) && (!where.expiresAt || h.expiresAt < where.expiresAt.lt)) { holds.splice(i, 1); n++; } } return { count: n }; },
      findMany: async ({ where }) => holds.filter(h => (!where.showId || h.showId === where.showId) && (!where.holderKey || h.holderKey === where.holderKey)),
      count: async ({ where }) => holds.filter(h => h.showId === where.showId && h.holderKey === where.holderKey).length,
    },
    ticket: { findMany: async ({ where }) => tickets.filter(t => t.showId === where.showId && (!where.status || where.status.in.includes(t.status))) },
  };
}
const LAYOUT = { rows: ['A', 'B'], seatsPerRow: 4, sections: [{ name: 'R', rows: ['A', 'B'] }] };
const show = { id: 's1', status: 'onsale', hall: { layout: LAYOUT } };

test('holding a free seat succeeds and expires after HOLD_MS', async () => {
  let t = 1_000_000; const prisma = fakePrisma();
  const h = makeHolds({ prisma, now: () => t });
  const r = await h.hold(show, 'A2', 'me');
  assert.equal(r.ok, true); assert.equal(r.expiresAt.getTime(), t + HOLD_MS);
});
test('two people holding the same seat in the same tick: exactly one wins, the other is told taken', async () => {
  const prisma = fakePrisma(); const h = makeHolds({ prisma, now: () => 1_000_000 });
  const [a, b] = await Promise.all([h.hold(show, 'A2', 'me'), h.hold(show, 'A2', 'you')]);
  assert.equal([a, b].filter(x => x.ok).length, 1);
  assert.equal([a, b].find(x => !x.ok).error, 'taken');
  assert.equal(prisma._.holds.length, 1);
});
test('a sold seat cannot be held even after its hold is gone', async () => {
  const prisma = fakePrisma(); prisma._.tickets.push({ showId: 's1', seats: ['A2'], status: 'CONFIRMED' });
  const h = makeHolds({ prisma, now: () => 1 });
  assert.equal((await h.hold(show, 'A2', 'me')).error, 'sold');
});
test('unknown or blocked seats, a closed show, and more than MAX_SEATS are refused', async () => {
  const prisma = fakePrisma(); const h = makeHolds({ prisma, now: () => 1 });
  assert.equal((await h.hold(show, 'Z9', 'me')).error, 'no_such_seat');
  assert.equal((await h.hold({ ...show, status: 'cancelled' }, 'A1', 'me')).error, 'show_closed');
  for (let i = 1; i <= MAX_SEATS; i++) await h.hold({ ...show, hall: { layout: { rows: ['A', 'B', 'C'], seatsPerRow: 4, sections: [{ name: 'R', rows: ['A', 'B', 'C'] }] } } }, 'A' + (i % 4 + 1) === 'A0' ? 'B1' : (i <= 4 ? 'A' + i : 'B' + (i - 4)), 'me');
  assert.equal((await h.hold({ ...show, hall: { layout: { rows: ['A', 'B', 'C'], seatsPerRow: 4, sections: [{ name: 'R', rows: ['A', 'B', 'C'] }] } } }, 'C1', 'me')).error, 'too_many');
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
```

- [ ] **Step 2: Run** → module not found.

- [ ] **Step 3: Implement**

```js
// cinema/holds.js
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
    if ((await prisma.seatHold.count({ where: { showId: show.id, holderKey } })) >= MAX_SEATS) return { ok: false, error: 'too_many' };
    const expiresAt = new Date(clock() + HOLD_MS);
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
    const L = show.hall.layout;
    const t = clock();
    const holds = await prisma.seatHold.findMany({ where: { showId: show.id } });
    const heldBy = new Map(holds.filter(h => h.expiresAt.getTime() > t).map(h => [h.seat, h.holderKey]));
    const sold = await soldSeats(show.id);
    return seatsFor(L).map(s => ({ ...s,
      state: s.blocked ? 'blocked' : sold.has(s.id) ? 'sold' : heldBy.has(s.id) ? (heldBy.get(s.id) === holderKey ? 'mine' : 'held') : 'free' }));
  }

  return { hold, release, sweep, mine, availability, soldSeats };
}

module.exports = { makeHolds, HOLD_MS, MAX_SEATS, SOLD_STATES };
```

- [ ] **Step 4: Run** → 6 pass. - [ ] **Step 5: Commit** `feat(cinema): seat holds - insert-or-taken on the unique constraint, expiry sweep, availability map`

---

### Task 4: `cinema/tickets.js` — checkout, QR, cancel, counter release

**Files:** Create `cinema/tickets.js`; Test `test/cinema/tickets.test.js`; add dependency `qrcode`.

- [ ] **Step 1: Install the QR library** — `npm i qrcode@1.5.4` (pure JS, no native build). Verify: `node -e "require('qrcode').toString('x',{type:'svg'}).then(s=>console.log(s.slice(0,40)))"` prints `<svg`.

- [ ] **Step 2: Failing tests**

```js
// test/cinema/tickets.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeTickets, makeCode } = require('../../cinema/tickets');
const { makeHolds } = require('../../cinema/holds');

const LAYOUT = { rows: ['A', 'B'], seatsPerRow: 4, sections: [{ name: 'VIP', rows: ['A'] }, { name: 'R', rows: ['B'] }] };
function world() {
  const holds = [], tickets = []; let seq = 0;
  const show = { id: 's1', status: 'onsale', startsAt: new Date(2_000_000_000), counterCutoffMin: 30, prices: { VIP: 500, R: 300 },
    hall: { layout: LAYOUT, venue: { name: 'Bina Hall', phone: '+251911000000' } }, event: { title: 'Film', titleAm: 'ፊልም' } };
  const p2002 = () => Object.assign(new Error('unique'), { code: 'P2002' });
  const prisma = { _: { holds, tickets, show },
    $transaction: async fn => fn(prisma),
    show: { findUnique: async () => ({ ...show }) },
    seatHold: {
      create: async ({ data }) => { if (holds.some(h => h.showId === data.showId && h.seat === data.seat)) throw p2002(); const h = { id: 'h' + (++seq), ...data }; holds.push(h); return h; },
      findMany: async ({ where }) => holds.filter(h => h.showId === where.showId && (!where.holderKey || h.holderKey === where.holderKey) && (!where.seat || where.seat.in.includes(h.seat))),
      deleteMany: async ({ where }) => { let n = 0; for (let i = holds.length - 1; i >= 0; i--) { const h = holds[i]; if (h.showId === where.showId && (!where.holderKey || h.holderKey === where.holderKey) && (!where.seat || where.seat.in.includes(h.seat))) { holds.splice(i, 1); n++; } } return { count: n }; },
      count: async ({ where }) => holds.filter(h => h.showId === where.showId && h.holderKey === where.holderKey).length,
    },
    ticket: {
      findMany: async ({ where }) => tickets.filter(t => (!where.showId || t.showId === where.showId) && (!where.status || (where.status.in ? where.status.in.includes(t.status) : t.status === where.status)) && (!where.payMethod || t.payMethod === where.payMethod) && (!where.createdAt || true)),
      findUnique: async ({ where }) => tickets.find(t => t.code === where.code || t.idemKey === where.idemKey || t.id === where.id) || null,
      create: async ({ data }) => { if (data.idemKey && tickets.some(t => t.idemKey === data.idemKey)) throw p2002(); const t = { id: 't' + (++seq), status: 'RESERVED', createdAt: new Date(), ...data }; tickets.push(t); return t; },
      updateMany: async ({ where, data }) => { let n = 0; for (const t of tickets) { if ((!where.id || t.id === where.id) && (!where.code || t.code === where.code) && (!where.status || (where.status.in ? where.status.in.includes(t.status) : t.status === where.status))) { Object.assign(t, data); n++; } } return { count: n }; },
    },
  };
  const sent = [];
  const tk = makeTickets({ prisma, holds: makeHolds({ prisma, now: () => 1_000_000 }), now: () => 1_000_000, notify: async (t, text) => { sent.push({ t, text }); return true; } });
  return { prisma, tk, show, sent };
}

test('checkout turns my holds into a ticket priced from the show, and deletes the holds', async () => {
  const w = world(); const h = makeHolds({ prisma: w.prisma, now: () => 1_000_000 });
  await h.hold(w.show, 'A1', 'me'); await h.hold(w.show, 'B2', 'me');
  const r = await w.tk.checkout({ showId: 's1', holderKey: 'me', seats: ['A1', 'B2'], name: 'Sara', phone: '0911223344', payMethod: 'counter', idemKey: 'k1' });
  assert.equal(r.ok, true); assert.equal(r.ticket.total, 800); assert.equal(r.ticket.status, 'RESERVED');
  assert.match(r.ticket.code, /^BINA-[A-Z2-9]{6}$/); assert.deepEqual(r.ticket.seats, ['A1', 'B2']);
  assert.equal(w.prisma._.holds.length, 0, 'holds consumed');
  assert.equal(r.ticket.phone, '+251911223344');
  assert.equal(w.sent.length, 1, 'the buyer is messaged once');
});
test('you cannot buy a seat you are not holding, or that someone else holds', async () => {
  const w = world(); const h = makeHolds({ prisma: w.prisma, now: () => 1_000_000 });
  await h.hold(w.show, 'A1', 'you');
  const r = await w.tk.checkout({ showId: 's1', holderKey: 'me', seats: ['A1'], name: 'S', phone: '0911223344', payMethod: 'counter', idemKey: 'k2' });
  assert.equal(r.ok, false); assert.equal(r.error, 'hold_expired'); assert.deepEqual(r.seats, ['A1']);
});
test('a double-tapped checkout returns the same ticket, not two', async () => {
  const w = world(); const h = makeHolds({ prisma: w.prisma, now: () => 1_000_000 });
  await h.hold(w.show, 'A1', 'me');
  const a = await w.tk.checkout({ showId: 's1', holderKey: 'me', seats: ['A1'], name: 'S', phone: '0911223344', payMethod: 'counter', idemKey: 'same' });
  const b = await w.tk.checkout({ showId: 's1', holderKey: 'me', seats: ['A1'], name: 'S', phone: '0911223344', payMethod: 'counter', idemKey: 'same' });
  assert.equal(a.ticket.code, b.ticket.code); assert.equal(w.prisma._.tickets.length, 1);
});
test('a non-Ethiopian phone is refused unless booking for someone else with an Ethiopian number', async () => {
  const w = world(); const h = makeHolds({ prisma: w.prisma, now: () => 1_000_000 });
  await h.hold(w.show, 'A1', 'me');
  assert.equal((await w.tk.checkout({ showId: 's1', holderKey: 'me', seats: ['A1'], name: 'S', phone: '+971501234567', payMethod: 'counter', idemKey: 'k3' })).error, 'phone');
  const r = await w.tk.checkout({ showId: 's1', holderKey: 'me', seats: ['A1'], name: 'Ibrahim', phone: '+971501234567', guest: { name: 'Sara', phone: '0911223344' }, payMethod: 'counter', idemKey: 'k4' });
  assert.equal(r.ok, true); assert.equal(r.ticket.name, 'Sara'); assert.equal(r.ticket.phone, '+251911223344');
});
test('counter reservations are released at the cutoff, paid ones are not', async () => {
  const w = world(); const h = makeHolds({ prisma: w.prisma, now: () => 1_000_000 });
  await h.hold(w.show, 'A1', 'me'); await h.hold(w.show, 'A2', 'me2');
  await w.tk.checkout({ showId: 's1', holderKey: 'me', seats: ['A1'], name: 'S', phone: '0911223344', payMethod: 'counter', idemKey: 'k5' });
  const paid = await w.tk.checkout({ showId: 's1', holderKey: 'me2', seats: ['A2'], name: 'T', phone: '0911223355', payMethod: 'counter', idemKey: 'k6' });
  await w.tk.markPaid(paid.ticket.code, 'counter');
  const cutoff = w.show.startsAt.getTime() - 30 * 60000 + 1;
  const tk2 = makeTickets({ prisma: w.prisma, holds: h, now: () => cutoff, notify: async () => true });
  assert.equal(await tk2.releaseUnpaid([w.show]), 1);
  assert.equal(w.prisma._.tickets[0].status, 'CANCELLED'); assert.equal(w.prisma._.tickets[1].status, 'CONFIRMED');
});
test('QR is an SVG that contains the ticket page URL', async () => {
  const w = world();
  const svg = await w.tk.qrSvg('BINA-ABC234', 'https://bina.et');
  assert.match(svg, /^<svg/); assert.ok(svg.length > 500);
});
test('makeCode never produces confusable characters', () => {
  for (let i = 0; i < 200; i++) assert.match(makeCode(), /^BINA-[A-HJ-NP-Z2-9]{6}$/);
});
```

- [ ] **Step 3: Run** → module not found.

- [ ] **Step 4: Implement**

```js
// cinema/tickets.js
'use strict';
// Checkout is a transaction: verify every seat is held by THIS holder and not sold, price each seat
// from the show's section prices, create the ticket, delete the holds. The idempotency key makes a
// double tap return the same ticket. Counter reservations are released at the cutoff by a sweep.
const crypto = require('crypto');
const QR = require('qrcode');
const { normPhone } = require('../ride/phone');
const { priceOf, isSeat } = require('./seatmap');
const { SOLD_STATES } = require('./holds');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
function makeCode() {
  const b = crypto.randomBytes(6); let s = '';
  for (let i = 0; i < 6; i++) s += ALPHABET[b[i] % ALPHABET.length];
  return 'BINA-' + s;
}

function makeTickets({ prisma, holds, now, notify, baseUrl }) {
  const clock = now || Date.now;
  const base = baseUrl || 'https://bina.et';

  async function checkout({ showId, holderKey, seats, name, phone, guest, payMethod, telegramId, idemKey }) {
    if (idemKey) { const dup = await prisma.ticket.findUnique({ where: { idemKey } }); if (dup) return { ok: true, ticket: dup, duplicate: true }; }
    const show = await prisma.show.findUnique({ where: { id: showId }, include: { hall: { include: { venue: true } }, event: true } });
    if (!show) return { ok: false, error: 'no_show' };
    if (show.status !== 'onsale') return { ok: false, error: 'show_closed' };
    seats = [...new Set((seats || []).filter(s => isSeat(show.hall.layout, s)))];
    if (!seats.length) return { ok: false, error: 'no_seats' };
    // Who is the ticket for? Booking for someone else needs an Ethiopian number for the guest.
    let who = { name: String(name || '').trim().slice(0, 60), phone: normPhone(phone) };
    if (guest && (guest.name || guest.phone)) who = { name: String(guest.name || '').trim().slice(0, 60), phone: normPhone(guest.phone) };
    if (!who.name || !who.phone) return { ok: false, error: 'phone' };
    const method = payMethod === 'chapa' ? 'chapa' : 'counter';

    return prisma.$transaction(async tx => {
      const t = clock();
      const mine = (await tx.seatHold.findMany({ where: { showId, holderKey, seat: { in: seats } } })).filter(h => h.expiresAt.getTime() > t);
      const missing = seats.filter(s => !mine.some(h => h.seat === s));
      if (missing.length) return { ok: false, error: 'hold_expired', seats: missing };
      const sold = new Set((await tx.ticket.findMany({ where: { showId, status: { in: SOLD_STATES } } })).flatMap(x => x.seats));
      const gone = seats.filter(s => sold.has(s));
      if (gone.length) return { ok: false, error: 'sold', seats: gone };
      let total = 0; for (const s of seats) total += priceOf(show.hall.layout, show.prices, s);
      let ticket;
      for (let attempt = 0; attempt < 3; attempt++) {
        try { ticket = await tx.ticket.create({ data: { code: makeCode(), showId, seats, name: who.name, phone: who.phone, telegramId: telegramId ? String(telegramId) : null, total, payMethod: method, status: 'RESERVED', idemKey: idemKey || null } }); break; }
        catch (e) { if (e.code !== 'P2002') throw e; if (idemKey) { const dup = await tx.ticket.findUnique({ where: { idemKey } }); if (dup) return { ok: true, ticket: dup, duplicate: true }; } }
      }
      if (!ticket) return { ok: false, error: 'code_collision' };
      await tx.seatHold.deleteMany({ where: { showId, holderKey, seat: { in: seats } } });
      if (notify) notify(ticket, ticketText(ticket, show)).catch(e => console.error('[cinema/tickets] notify failed: ' + e.message));
      return { ok: true, ticket, show };
    });
  }

  function ticketText(t, show) {
    const when = new Date(show.startsAt).toISOString().slice(0, 16).replace('T', ' ');
    const venue = show.hall && show.hall.venue;
    return ['🎟️ ' + (show.event.titleAm || show.event.title), '📍 ' + (venue ? venue.name : '') + ' · ' + show.hall.name, '🕒 ' + when + ' UTC',
      '💺 ' + t.seats.join(', '), '💰 ' + t.total + ' ብር · ' + (t.payMethod === 'counter' ? 'በካውንተር ይከፈላል · pay at the counter' : 'Chapa'),
      '', 'ኮድ · Code: ' + t.code, base + '/ticket/' + t.code].join('\n');
  }

  async function markPaid(code, via, chapaRef) {
    const r = await prisma.ticket.updateMany({ where: { code, status: 'RESERVED' }, data: { status: 'CONFIRMED', chapaRef: chapaRef || null, payMethod: via === 'chapa' ? 'chapa' : 'counter' } });
    return r.count > 0;
  }

  async function cancel(code, by) {
    const r = await prisma.ticket.updateMany({ where: { code, status: { in: ['RESERVED', 'CONFIRMED'] } }, data: { status: 'CANCELLED' } });
    return r.count > 0;
  }

  // Counter reservations that are still unpaid at the cutoff give their seats back.
  async function releaseUnpaid(shows) {
    let n = 0; const t = clock();
    for (const show of shows) {
      const cutoff = new Date(show.startsAt).getTime() - (show.counterCutoffMin || 30) * 60000;
      if (t < cutoff) continue;
      const due = await prisma.ticket.findMany({ where: { showId: show.id, status: 'RESERVED', payMethod: 'counter' } });
      for (const tk of due) {
        const r = await prisma.ticket.updateMany({ where: { id: tk.id, status: 'RESERVED' }, data: { status: 'CANCELLED' } });
        if (r.count) { n++; if (notify) notify(tk, '⌛ ' + tk.code + ' — ' + tk.seats.join(', ') + ' ተለቀዋል፤ ክፍያው በሰዓቱ አልተፈጸመም። · released, unpaid by the cutoff.').catch(() => {}); }
      }
    }
    return n;
  }

  async function qrSvg(code, b) { return QR.toString((b || base) + '/ticket/' + code, { type: 'svg', margin: 1, width: 320 }); }

  return { checkout, markPaid, cancel, releaseUnpaid, qrSvg, ticketText };
}

module.exports = { makeTickets, makeCode };
```

- [ ] **Step 5: Run** → 7 pass. - [ ] **Step 6: Commit** `feat(cinema): checkout transaction, idempotent tickets, QR, counter release`

---

### Task 5: `cinema/checkin.js` — the door

**Files:** Create `cinema/checkin.js`; Test `test/cinema/checkin.test.js`

- [ ] **Step 1: Failing tests**

```js
// test/cinema/checkin.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeCheckin } = require('../../cinema/checkin');

function world(tickets) {
  const prisma = { ticket: {
    findUnique: async ({ where }) => { const t = tickets.find(x => x.code === where.code); return t ? { ...t, show: t.show } : null; },
    updateMany: async ({ where, data }) => { const t = tickets.find(x => x.code === where.code && x.status === where.status); if (!t) return { count: 0 }; Object.assign(t, data); return { count: 1 }; },
  } };
  return makeCheckin({ prisma, now: () => 1_000_000 });
}
const show = { id: 's1', startsAt: new Date(1_000_000 + 3600_000), event: { title: 'Film' }, hall: { name: 'Hall 1' } };

test('a confirmed ticket checks in once; the second scan is refused with the time of the first', async () => {
  const c = world([{ code: 'BINA-AAAAAA', status: 'CONFIRMED', seats: ['A1'], name: 'Sara', showId: 's1', show }]);
  const a = await c.scan('BINA-AAAAAA', 's1');
  assert.equal(a.ok, true); assert.equal(a.ticket.status, 'CHECKED_IN');
  const b = await c.scan('BINA-AAAAAA', 's1');
  assert.equal(b.ok, false); assert.equal(b.error, 'already_checked_in'); assert.ok(b.at);
});
test('reserved-but-unpaid, cancelled, unknown, and wrong-show tickets are refused with the reason', async () => {
  const c = world([{ code: 'BINA-RRRRRR', status: 'RESERVED', seats: ['A1'], showId: 's1', show },
    { code: 'BINA-CCCCCC', status: 'CANCELLED', seats: ['A2'], showId: 's1', show }]);
  assert.equal((await c.scan('BINA-RRRRRR', 's1')).error, 'unpaid');
  assert.equal((await c.scan('BINA-CCCCCC', 's1')).error, 'cancelled');
  assert.equal((await c.scan('BINA-XXXXXX', 's1')).error, 'unknown');
  assert.equal((await c.scan('BINA-RRRRRR', 's2')).error, 'wrong_show');
});
test('codes are normalised: lower case, spaces, the URL form, all scan the same ticket', async () => {
  const c = world([{ code: 'BINA-AAAAAA', status: 'CONFIRMED', seats: ['A1'], showId: 's1', show }]);
  assert.equal((await c.scan(' bina-aaaaaa ', 's1')).ok, true);
  const c2 = world([{ code: 'BINA-AAAAAA', status: 'CONFIRMED', seats: ['A1'], showId: 's1', show }]);
  assert.equal((await c2.scan('https://bina.et/ticket/BINA-AAAAAA', 's1')).ok, true);
});
```

- [ ] **Step 2: Run** → fails. - [ ] **Step 3: Implement**

```js
// cinema/checkin.js
'use strict';
// First scan wins. Everything else is a clear, specific refusal the door can read out.
function makeCheckin({ prisma, now }) {
  const clock = now || Date.now;
  function normalise(raw) {
    const s = String(raw || '').trim();
    const m = s.match(/BINA-[A-Za-z0-9]{6}/i);
    return m ? m[0].toUpperCase() : s.toUpperCase();
  }
  async function scan(raw, showId) {
    const code = normalise(raw);
    const t = await prisma.ticket.findUnique({ where: { code }, include: { show: { include: { event: true, hall: true } } } });
    if (!t) return { ok: false, error: 'unknown', code };
    if (showId && t.showId !== showId) return { ok: false, error: 'wrong_show', ticket: t };
    if (t.status === 'CHECKED_IN') return { ok: false, error: 'already_checked_in', at: t.checkedInAt, ticket: t };
    if (t.status === 'CANCELLED') return { ok: false, error: 'cancelled', ticket: t };
    if (t.status === 'RESERVED') return { ok: false, error: 'unpaid', ticket: t };
    const r = await prisma.ticket.updateMany({ where: { code, status: 'CONFIRMED' }, data: { status: 'CHECKED_IN', checkedInAt: new Date(clock()) } });
    if (!r.count) return { ok: false, error: 'already_checked_in', ticket: t };   // lost a scan race
    return { ok: true, ticket: { ...t, status: 'CHECKED_IN' } };
  }
  return { scan, normalise };
}
module.exports = { makeCheckin };
```

- [ ] **Step 4: Run** → 3 pass. - [ ] **Step 5: Commit** `feat(cinema): door check-in state machine, first scan wins`

---

### Task 6: `cinema/routes.js` + `cinema/index.js` — HTTP API and mounting

**Files:** Create `cinema/routes.js`, `cinema/index.js`; Modify `server.js`; Test `test/cinema/routes.test.js`

Endpoints (public unless marked ops):
- `GET  /cinema`, `/cinema/:showId`, `/ticket/:code`, `/scan`, `/ops/cinema` → static pages
- `GET  /api/cinema/shows` → upcoming onsale shows with event, venue, hall, prices, seatsLeft
- `GET  /api/cinema/shows/:id` → show + `layout` + `availability` (holder key from header `x-holder`)
- `POST /api/cinema/shows/:id/hold {seat}` / `…/release {seats?}`
- `POST /api/cinema/tickets {showId, seats, name, phone, guest?, payMethod, idemKey, tg?}` → ticket (+ Chapa checkout URL when `payMethod=chapa`)
- `GET  /api/cinema/tickets/:code` (public, minimal) and `GET /api/cinema/tickets/:code/qr.svg`
- `POST /api/cinema/chapa/verify {ref}` → marks CONFIRMED on success
- ops: `POST /api/cinema/ops/venues`, `/halls`, `/events`, `/shows`; `GET /api/cinema/ops/shows/:id/tickets`; `POST /api/cinema/ops/tickets/:code/paid | /cancel`; `POST /api/cinema/ops/shows/:id/cancel`; `POST /api/cinema/ops/checkin {code, showId}`

Holder key: `x-holder` header — a random 24-char id the browser stores in `localStorage` (Telegram users use `tg:<id>` after `initData` verification, same helper as Ride). Rate limits: 60 holds/min per holder, 5 checkouts/10 min per phone, using the same tiny in-memory limiter pattern as `ride/routes.js`.

- [ ] **Step 1: Failing route tests** (Fastify `inject`, fake Prisma as in `test/tgRoutes.test.js`; assert: shows list, hold 200 then 409 taken for a second holder, checkout 200 with total from prices, checkout 409 `hold_expired` when not held, ops endpoints 401 without key, check-in twice → 200 then 409). Write them mirroring Task 4's fake.

- [ ] **Step 2: Implement `cinema/index.js`**

```js
// cinema/index.js
'use strict';
const { makeHolds } = require('./holds');
const { makeTickets } = require('./tickets');
const { makeCheckin } = require('./checkin');
const registerRoutes = require('./routes');

// registerCinema(fastify, { prisma, telegram, OWNER_KEY, BASE_URL, riderBotToken, chapa })
module.exports = function registerCinema(fastify, deps) {
  if (process.env.CINEMA_ENABLED !== '1') { console.log('[cinema] disabled (CINEMA_ENABLED != 1)'); return null; }
  const holds = makeHolds({ prisma: deps.prisma });
  const notify = async (ticket, text) => {
    if (ticket.telegramId && deps.telegram && deps.telegram.toChat) return deps.telegram.toChat(ticket.telegramId, text);
    return false; // no Telegram identity: the ticket page + SMS-free path is the fallback
  };
  const tickets = makeTickets({ prisma: deps.prisma, holds, notify, baseUrl: deps.BASE_URL });
  const checkin = makeCheckin({ prisma: deps.prisma });
  registerRoutes(fastify, { ...deps, holds, tickets, checkin });

  // Timers: expired holds every 30 s; counter releases every 60 s. Both idempotent, both safe to miss.
  const t1 = setInterval(() => holds.sweep().catch(e => console.error('[cinema] sweep: ' + e.message)), 30000);
  const t2 = setInterval(async () => {
    try {
      const soon = await deps.prisma.show.findMany({ where: { status: 'onsale', startsAt: { gte: new Date(Date.now() - 3600000), lte: new Date(Date.now() + 6 * 3600000) } } });
      const n = await tickets.releaseUnpaid(soon); if (n) console.log('[cinema] released ' + n + ' unpaid reservation(s)');
    } catch (e) { console.error('[cinema] release: ' + e.message); }
  }, 60000);
  t1.unref(); t2.unref();
  console.log('[cinema] mounted');
  return { holds, tickets, checkin };
};
```

- [ ] **Step 3: Implement `cinema/routes.js`** — page routes via `reply.sendFile`, the API above, `ops()` copied from `ride/routes.js`, Telegram `initData` verification reused from `ride/tgauth.js` with `riderBotToken`, Chapa via `deps.chapa.init(amount, ref, meta)` / `deps.chapa.verify(ref)` (wrap the existing `chapaApi`/`chapaVerify` in `server.js` into that object when mounting). Availability response: `{ show, layout, seats: [...availability], prices, holdMs }`.

- [ ] **Step 4: Mount in `server.js`** next to `registerRide`:

```js
const registerCinema = require('./cinema');
registerCinema(fastify, { prisma, telegram: rideTelegramForCinema, OWNER_KEY, BASE_URL: 'https://bina.et', riderBotToken: process.env.BINA_RIDER_BOT_TOKEN,
  chapa: { init: (amount, ref, meta) => chapaApi('/transaction/initialize', 'POST', { amount, currency: 'ETB', tx_ref: ref, ...meta }), verify: chapaVerify } });
```
and add `'https://bina.et/cinema'` to the sitemap list plus every onsale show URL.

- [ ] **Step 5: Run all tests** → green. Start with `CINEMA_ENABLED=1` in `.env`, `pm2 restart binasmart-api`, `curl -s https://bina.et/api/cinema/shows` → `{"ok":true,"shows":[]}`.

- [ ] **Step 6: Commit** `feat(cinema): HTTP API, mounting behind CINEMA_ENABLED, hold and release sweeps`

---

### Task 7: The seat-map page — `public/cinema.html` + `public/cinema/app.js` + `ui.css`

**Files:** Create the three; reuse `public/ride/tg.js` for the Telegram shim.

- [ ] **Step 1: Listing** — `/cinema`: hero, then cards grouped by Event (poster, Amharic title, next showtimes as chips, "from 300 ብር"). Light theme tokens copied from `why-binasmart.html`.

- [ ] **Step 2: Seat map** — `/cinema/<showId>`: fetch `/api/cinema/shows/:id`; render a CSS grid from `layout.rows × seatsPerRow` with an extra gap column after each aisle; seat button classes `free|held|sold|blocked|mine|wheelchair`; section legend with prices; "ስክሪን · SCREEN" bar on top; sticky bottom bar with chosen seats, total, a **10:00 countdown** from the earliest of my holds, and the **ይቀጥሉ · Continue** button. Tap → `POST hold`; on 409 `taken` flash the seat red with "ተይዟል · just taken" and refresh the map. Poll availability every 5 s while the page is open. Max 8.

- [ ] **Step 3: Checkout sheet** — name, Ethiopian phone (auto-filled from Telegram contact when available, same `requestContact` flow as Ride), "ለሌላ ሰው · for someone else" toggle, payment choice (Chapa / counter), Continue → `POST /api/cinema/tickets`. On `hold_expired` → re-open the map with the lost seats marked. Success → redirect to `/ticket/<code>`.

- [ ] **Step 4: Verify in the browser pane** at 375 px: no horizontal scroll, seat targets ≥ 34 px, countdown visible, all states legible. Screenshot for the record.

- [ ] **Step 5: Commit** `feat(cinema): listing, live seat map with holds and countdown, checkout`

---

### Task 8: Ticket, scanner, ops pages

- [ ] **Step 1: `public/ticket.html`** — big QR (inline SVG from `/api/cinema/tickets/:code/qr.svg`), event, venue, hall, time, seats, total, status pill (RESERVED: "በካውንተር ይክፈሉ · pay at the counter before HH:MM" / CONFIRMED / CHECKED_IN / CANCELLED). "Add to Telegram" button that deep-links `@bina_smart_bot` with `start=ticket_<code>` so the bot resends it.

- [ ] **Step 2: `public/scan.html`** (owner key in `?key=`) — choose the show, then `BarcodeDetector` camera scan where supported, manual code entry fallback, `POST /api/cinema/ops/checkin`. Full-screen result: green ✅ with name + seats, or red ✕ with the reason in Amharic and English, auto-clears after 3 s. Counter of checked-in vs sold for the show.

- [ ] **Step 3: `public/ops-cinema.html`** — four forms (Venue, Hall with live layout preview from the template, Event, Show) + a per-show ticket table with "mark paid" and "cancel". All POSTs carry `x-owner-key`.

- [ ] **Step 4: Verify each page live**, commit `feat(cinema): ticket page with QR, door scanner, ops admin`.

---

### Task 9: Simulator, live race proof, seed script

- [ ] **Step 1: `ops/cinema/seed-first-venue.js`** — creates Venue/Hall/Event/Show from constants at the top of the file (Ibrahim edits name, rows, seatsPerRow, sections, prices, showtime). Idempotent on slug.

- [ ] **Step 2: `ops/cinema/sim.js`** — against the live database with Telegram stubbed (set `RIDE_TG_SILENT=1` pattern → `CINEMA_TG_SILENT=1`): creates a throwaway venue/hall/show, holds seats from two holders concurrently over HTTP (`Promise.all` of two `POST hold` for the same seat → exactly one 200, one 409), checks out, verifies price, scans twice (200 then 409), releases an unpaid reservation by advancing the show time, cancels the show, and **deletes everything it created**, asserting zero leftovers by exact ids (not prefixes — lesson from the ride sim). Prints `ALL N CHECKS PASSED`.

- [ ] **Step 3: Run it** on production → all pass, leftovers 0. Commit `test(cinema): end-to-end simulator and first-venue seed`.

---

### Task 10: Docs, health, sitemap, go-live checklist

- [ ] **Step 1:** `ops/cinema/README.md` — how to add a venue/hall/show, what each ticket status means, what the two sweeps do, how to flip Chapa live, the door procedure.
- [ ] **Step 2:** `ops/health/check.js` — add `'Cinema page'` (`GET /cinema` → 200) and `'Cinema API'` (`GET /api/cinema/shows` → ok:true) when `CINEMA_ENABLED=1`.
- [ ] **Step 3:** `.env.example` gains `CINEMA_ENABLED=0` with a comment.
- [ ] **Step 4:** Commit and push. Go-live: seed the first real venue → sim once more → set `CINEMA_ENABLED=1` → one real show on sale → replace the homepage `/events` link with `/cinema`.

---

## Self-review

- **Spec coverage:** venues/halls/template (T1–2), holds mutex + 10-min expiry + sweep (T3, T6), checkout with server prices, idempotency, book-for-someone-else, counter vs Chapa, cutoff release (T4, T6), door first-scan-wins (T5, T8), ops (T6, T8), pages/Telegram Mini App (T7–8), tests incl. race and live proof (T3, T4, T9), rollout behind a flag (T6, T10). Show cancellation messaging buyers is in T6's ops cancel (loop tickets → `cancel` + notify) — make sure the route does both.
- **Names are consistent across tasks:** `makeHolds/hold/release/sweep/availability`, `makeTickets/checkout/markPaid/cancel/releaseUnpaid/qrSvg`, `makeCheckin/scan`, `isSeat/priceOf/seatsFor`, header `x-holder`, statuses `RESERVED|CONFIRMED|CHECKED_IN|CANCELLED`, show statuses `onsale|soldout|cancelled|closed`.
- **No placeholders:** every code step is complete; T7–T8 are UI and are specified to the element level rather than as full files, which is deliberate — they are verified in the browser, not by unit tests.
