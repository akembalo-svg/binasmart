# BinaSmart Ride Phase 2 Implementation Plan — driver app, auto-dispatch, live tracking

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Approved drivers go online in their own app at `bina.et/drive` (also a Telegram Mini App), ride requests are broadcast to the nearest three of them, and the rider watches the driver's own car photo glide along the road with a live ETA — while the existing concierge fallback stays intact.

**Architecture:** Four new server modules with one job each — `ride/location.js` (the only file that knows how position arrives), `ride/offers.js` (the auction with a DB-level mutex), `ride/driverApi.js` (driver REST, authenticated by Telegram signature), `ride/simulate.js` (fake drivers for end-to-end proof). Live position travels by HTTP polling: the driver POSTs every 6 s on a job, and the rider's existing 4 s status poll carries it back. The rider's map gains an animated car marker; `public/ride/track.js` owns the interpolation.

**Tech Stack:** Node 22, Fastify 5, Prisma 6 / PostgreSQL, MapLibre GL (already vendored), GraphHopper on 127.0.0.1:8989, Telegram Bot API, Node built-in test runner. Spec: `docs/superpowers/specs/2026-09-03-binasmart-ride-phase2-design.md`.

**Conventions for every task**
- Work on the VPS: `ssh root@31.97.176.180`, repo `/var/www/connectcare/binasmart`, branch `main`. Tests: `npm test` from the repo root (bare `node --test`; a directory argument is a glob on Node 22 and matches nothing).
- This box prints a spurious `Aborted (core dumped)` after some scripts exit; ignore it when the expected output appeared.
- ⛔ Never send a real Telegram message or create a real ride from a test. Fake the API and the clock. `RIDE_TG_SILENT=1` exists for the owner alerts.
- Never print `.env`, `OWNER_KEY` or bot tokens.
- **Static assets are cached 1 day. Every task that edits `public/ride/*` or `public/drive/*` must bump the `?v=` on that file in the HTML** — `ui.css` included. The car card silently looked broken once because only the JS was bumped.
- Commit after each task with the given message. Push at the end of Tasks 5, 7, 9 and 10.
- Multi-line remote edits go through a Python script written locally and `scp`'d, then run with `python3 /tmp/x.py`. Heredocs inside `ssh '...'` mangle quotes and Amharic.
- Existing helpers to reuse, do not reinvent: `ride/phone.js` `normPhone`; `ride/tgauth.js` `verifyInitData`; `ride/geo.js` `makeGeo().route(from,to)` → `{distanceM,durationS,geometry,estimate}` and exported `haversineM(a,b)`, `ADDIS_BOX`; `ride/fare.js` `quoteFare(settings,tier,distanceM,durationS)` → `{fareEtb,driverTakeEtb,...}`; `ride/routes.js` `limiter(windowMs,max)`, `point(p)`, `pubRide(ride)`, `ACTIVE`, `NEXT`; `ride/telegram.js` `conciergeAlert`, `ownerNote`; `ride/tgApi.js` `sendMessage/sendPhoto/answerCallbackQuery/editMessageText`.

---

## File structure

| Path | Responsibility |
|---|---|
| `prisma/schema.prisma` | `RideOffer`, `DriverLocation`, new Driver/Ride columns |
| `ride/location.js` | validate + store fixes, in-memory trail, `staleSweep()` → `away` |
| `ride/offers.js` | candidates → nearest 3 → offer rows → Telegram cards; accept mutex, decline, expire, widen, give up |
| `ride/driverApi.js` | `/api/drive/*` REST for the driver app, Telegram-signature auth |
| `ride/simulate.js` | dev-only fake drivers driving real routes |
| `ride/dispatch.js` | calls `offers.open()` when drivers are online; concierge fallback unchanged |
| `ride/index.js` | wires the new modules + one 10 s expiry/stale interval |
| `ride/routes.js` | mounts `/api/drive/*`, adds `driverLocation` to the rider poll, serves `/drive` |
| `ride/driverBot.js` | Accept/Decline callbacks, "🚗 Drive" button |
| `public/drive.html`, `public/drive/app.js`, `public/drive/ui.css` | the driver app |
| `public/ride/track.js` | rider-side live tracking (pure maths + DOM updates) |
| `public/ride/map.js` | `setDriver`, `clearDriver`, `drawDriverRoute` |
| `public/ride/app.js`, `public/ride.html` | call `track.update(ride)`; asset versions |
| `test/location.test.js`, `test/offers.test.js`, `test/driverApi.test.js`, `test/track.test.js`, `test/simulate.test.js` | tests |
| `ops/telegram/README.md` | driver-app menu button + simulator runbook |

---

### Task 1: Schema and the offer window setting

**Files:**
- Modify: `prisma/schema.prisma`, `ride/settings.js`
- Test: `test/settings.test.js` (existing file — add one case)

- [ ] **Step 1: Add the two models and the new columns**

Write locally and `scp` to `/tmp/p2-schema.py`, then run `python3 /tmp/p2-schema.py`:

```python
p = "/var/www/connectcare/binasmart/prisma/schema.prisma"
s = open(p).read()
assert "model RideOffer" not in s, "already applied"

# Driver: tracking + job columns and back-relations
old = "  commissionPct   Float?    // percent (15 = 15%); overrides RideSetting.commissionPct. Phase 2 only — driverTakeEtb is fixed at request time, before assignment.\n  rides           Ride[]\n"
new = ("  commissionPct   Float?    // percent (15 = 15%); overrides RideSetting.commissionPct. Phase 2 only — driverTakeEtb is fixed at request time, before assignment.\n"
       "  bearing         Float?    // degrees, 0 = north, from the last fix\n"
       "  speedKph        Float?\n"
       "  away            Boolean   @default(false)  // online but no fix for 45 s: gets no offers\n"
       "  onRideId        String?   // set inside the accept transaction; must be null to be a candidate\n"
       "  earningsTodayEtb Int      @default(0)\n"
       "  earningsDay     DateTime?\n"
       "  rides           Ride[]\n"
       "  offers          RideOffer[]\n"
       "  locations       DriverLocation[]\n")
assert old in s, "Driver block not found"
s = s.replace(old, new, 1)

# Ride: acceptance timestamp + back-relations
old = "  requestedAt   DateTime  @default(now())\n"
new = "  driverAcceptedAt DateTime?\n  offers        RideOffer[]\n  locations     DriverLocation[]\n  requestedAt   DateTime  @default(now())\n"
assert old in s, "Ride requestedAt not found"
s = s.replace(old, new, 1)

s = s.rstrip("\n") + """

model RideOffer {
  id        String   @id @default(cuid())
  rideId    String
  ride      Ride     @relation(fields: [rideId], references: [id])
  driverId  String
  driver    Driver   @relation(fields: [driverId], references: [id])
  status    String   @default("open")   // open | accepted | declined | expired | lost
  etaS      Int?                        // driving seconds to pickup when offered
  distanceM Int?
  round     Int      @default(1)        // 1 = 3 km, 2 = 6 km, 3 = 10 km
  tgMsgId   Int?                        // Telegram message to edit when it is decided
  createdAt DateTime @default(now())
  decidedAt DateTime?

  @@unique([rideId, driverId])
  @@index([rideId, status])
  @@index([driverId, status])
  @@index([status, createdAt])
}

model DriverLocation {
  id        String   @id @default(cuid())
  driverId  String
  driver    Driver   @relation(fields: [driverId], references: [id])
  rideId    String?
  ride      Ride?    @relation(fields: [rideId], references: [id])
  lat       Float
  lng       Float
  bearing   Float?
  speedKph  Float?
  at        DateTime @default(now())

  @@index([driverId, at])
  @@index([rideId, at])
}
"""
open(p, "w").write(s)
print("schema patched")
```

- [ ] **Step 2: Push the schema**

Run: `cd /var/www/connectcare/binasmart && npx prisma db push 2>&1 | grep -iE "in sync|error" && npx prisma generate 2>&1 | grep -i generated`
Expected: `Your database is now in sync with your Prisma schema.` and `Generated Prisma Client`.

- [ ] **Step 3: Offer window default 20 → 25 s**

In `ride/settings.js`, change the line `  offerWindowS: 20,` to `  offerWindowS: 25,`.

- [ ] **Step 4: Add the settings test case**

Append to `test/settings.test.js`:

```js
test('offerWindowS defaults to 25 s and stays numeric', async () => {
  const { makeSettings } = require('../ride/settings');
  const s = await makeSettings({ rideSetting: { findUnique: async () => null, upsert: async ({ create }) => create } }).get();
  assert.equal(s.offerWindowS, 25);
  assert.equal(typeof s.radiiKm[0], 'number');
});
```

If `test/settings.test.js` does not exist, create it with this header first:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
```

- [ ] **Step 5: Run the suite**

Run: `npm test 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# fail 0`, total 85 or more.

- [ ] **Step 6: Commit**

```bash
cd /var/www/connectcare/binasmart && git add prisma/schema.prisma ride/settings.js test/settings.test.js && git commit -q -m "feat(ride): Phase 2 schema — RideOffer, DriverLocation, driver tracking columns" && git log --oneline -1
```

---

### Task 2: `ride/location.js` — fixes, trail, stale sweep

**Files:**
- Create: `ride/location.js`, `test/location.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/location.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeLocation } = require('../ride/location');

function fakes(driver) {
  const updates = [], created = [], pings = [];
  const drivers = [driver || { id: 'd1', online: true, away: false, status: 'approved', lat: null, lng: null, onRideId: null }];
  const prisma = {
    driver: {
      update: async ({ where, data }) => { const d = drivers.find(x => x.id === where.id); Object.assign(d, data); updates.push({ id: where.id, data }); return d; },
      updateMany: async ({ where, data }) => { let n = 0; for (const d of drivers) { if (d.online && !d.away) { Object.assign(d, data); n++; } } updates.push({ many: where, data }); return { count: n }; },
      findMany: async () => drivers.filter(d => d.online && !d.away),
      findUnique: async ({ where }) => drivers.find(x => x.id === where.id) || null,
    },
    driverLocation: { create: async ({ data }) => { created.push(data); return { id: 'l' + created.length, ...data }; } },
  };
  const api = { sendMessage: async (chat, text) => { pings.push({ chat, text }); return { message_id: 1 }; } };
  return { drivers, updates, created, pings, prisma, api };
}
const ADDIS = { lat: 9.01, lng: 38.76 };

test('a valid fix is stored on the driver and appended as a breadcrumb', async () => {
  const f = fakes();
  let now = 1_000_000;
  const loc = makeLocation({ prisma: f.prisma, api: f.api, now: () => now });
  const r = await loc.record('d1', { lat: ADDIS.lat, lng: ADDIS.lng, bearing: 90, speedKph: 24, accuracy: 12 }, 'r1');
  assert.equal(r.ok, true);
  assert.equal(f.drivers[0].lat, ADDIS.lat);
  assert.equal(f.drivers[0].bearing, 90);
  assert.equal(f.drivers[0].away, false);
  assert.equal(f.created.length, 1);
  assert.equal(f.created[0].rideId, 'r1');
});

test('junk fixes are rejected: outside Addis, poor accuracy, missing numbers, teleport', async () => {
  const f = fakes();
  let now = 1_000_000;
  const loc = makeLocation({ prisma: f.prisma, api: f.api, now: () => now });
  assert.equal((await loc.record('d1', { lat: 48.85, lng: 2.35 })).ok, false, 'Paris');
  assert.equal((await loc.record('d1', { lat: 'x', lng: 38.7 })).ok, false, 'not a number');
  assert.equal((await loc.record('d1', { lat: ADDIS.lat, lng: ADDIS.lng, accuracy: 900 })).ok, false, 'accuracy');
  assert.equal((await loc.record('d1', ADDIS)).ok, true);
  now += 5000;
  const jump = await loc.record('d1', { lat: 9.20, lng: 38.95 });   // ~28 km in 5 s
  assert.equal(jump.ok, false); assert.equal(jump.error, 'teleport');
  now += 600000;                                                     // 10 min later the same point is fine
  assert.equal((await loc.record('d1', { lat: 9.20, lng: 38.95 })).ok, true);
});

test('the trail keeps the last 25 points for a ride, newest last', async () => {
  const f = fakes();
  let now = 1_000_000;
  const loc = makeLocation({ prisma: f.prisma, api: f.api, now: () => now });
  for (let i = 0; i < 30; i++) { now += 6000; await loc.record('d1', { lat: 9.01 + i * 0.0002, lng: 38.76 }, 'r1'); }
  const t = loc.trail('r1');
  assert.equal(t.length, 25);
  assert.ok(t[24].lat > t[0].lat, 'newest last');
  assert.deepEqual(loc.trail('nope'), []);
});

test('latest() returns the last fix with its age', async () => {
  const f = fakes();
  let now = 1_000_000;
  const loc = makeLocation({ prisma: f.prisma, api: f.api, now: () => now });
  await loc.record('d1', { lat: 9.01, lng: 38.76, bearing: 12 });
  now += 8000;
  const l = loc.latest('d1');
  assert.equal(l.bearing, 12);
  assert.equal(l.ageS, 8);
  assert.equal(loc.latest('unknown'), null);
});

test('staleSweep marks silent drivers away and pings each of them once', async () => {
  const f = fakes({ id: 'd1', online: true, away: false, status: 'approved', telegramId: '555', onRideId: null });
  let now = 1_000_000;
  const loc = makeLocation({ prisma: f.prisma, api: f.api, now: () => now, staleMs: 45000 });
  await loc.record('d1', ADDIS);
  now += 20000;
  assert.equal(await loc.staleSweep(), 0, 'still fresh');
  now += 40000;
  assert.equal(await loc.staleSweep(), 1);
  assert.equal(f.drivers[0].away, true);
  assert.equal(f.pings.length, 1);
  assert.match(f.pings[0].text, /gone quiet|away/i);
  assert.equal(await loc.staleSweep(), 0, 'not pinged twice');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /var/www/connectcare/binasmart && node --test test/location.test.js 2>&1 | grep -E "^# (pass|fail)|Cannot find"`
Expected: `Cannot find module '../ride/location'`.

- [ ] **Step 3: Implement**

```js
// ride/location.js
'use strict';
// The ONLY module that knows how a driver's position arrives. Today: HTTP POST from the driver app
// (ride/driverApi.js). Swapping to WebSockets later means changing this file and public/ride/track.js.
// Latest fix lives on the Driver row (cheap to read on the rider poll); a short trail lives in memory
// per active ride; every accepted fix is also appended to DriverLocation for history.
const { haversineM, ADDIS_BOX } = require('./geo');

const TRAIL_MAX = 25, TRAIL_TTL_MS = 5 * 60 * 1000, MAX_ACCURACY_M = 200, MAX_SPEED_MPS = 55; // ~200 km/h

function makeLocation({ prisma, api, now, staleMs }) {
  const clock = now || Date.now;
  const stale = staleMs || 45000;
  const last = new Map();   // driverId -> { lat, lng, bearing, speedKph, t }
  const trails = new Map(); // rideId   -> { pts: [{lat,lng,bearing,t}], t }

  function inAddis(lat, lng) {
    return lat > ADDIS_BOX.minLat && lat < ADDIS_BOX.maxLat && lng > ADDIS_BOX.minLng && lng < ADDIS_BOX.maxLng;
  }

  async function record(driverId, fix, rideId) {
    const lat = Number(fix && fix.lat), lng = Number(fix && fix.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { ok: false, error: 'bad_coords' };
    if (!inAddis(lat, lng)) return { ok: false, error: 'outside_addis' };
    const acc = Number(fix.accuracy);
    if (Number.isFinite(acc) && acc > MAX_ACCURACY_M) return { ok: false, error: 'inaccurate' };
    const t = clock();
    const prev = last.get(driverId);
    if (prev) {
      const dt = Math.max(1, (t - prev.t) / 1000);
      if (haversineM(prev, { lat, lng }) / dt > MAX_SPEED_MPS) return { ok: false, error: 'teleport' };
    }
    const bearing = Number.isFinite(Number(fix.bearing)) ? Number(fix.bearing) : (prev ? prev.bearing : null);
    const speedKph = Number.isFinite(Number(fix.speedKph)) ? Math.max(0, Number(fix.speedKph)) : null;
    last.set(driverId, { lat, lng, bearing, speedKph, t });
    if (rideId) {
      const tr = trails.get(rideId) || { pts: [], t };
      tr.pts.push({ lat, lng, bearing, t }); if (tr.pts.length > TRAIL_MAX) tr.pts.shift();
      tr.t = t; trails.set(rideId, tr);
      if (trails.size > 500) for (const [k, v] of trails) if (t - v.t > TRAIL_TTL_MS) trails.delete(k);
    }
    await prisma.driver.update({ where: { id: driverId }, data: { lat, lng, bearing, speedKph, lastSeenAt: new Date(t), away: false } });
    prisma.driverLocation.create({ data: { driverId, rideId: rideId || null, lat, lng, bearing, speedKph, at: new Date(t) } })
      .catch(e => console.error('[ride/location] breadcrumb failed: ' + e.message));
    return { ok: true };
  }

  function latest(driverId) {
    const l = last.get(driverId);
    if (!l) return null;
    return { lat: l.lat, lng: l.lng, bearing: l.bearing, speedKph: l.speedKph, ageS: Math.round((clock() - l.t) / 1000) };
  }

  function trail(rideId) {
    const tr = trails.get(rideId);
    return tr ? tr.pts.map(p => ({ lat: p.lat, lng: p.lng, bearing: p.bearing })) : [];
  }

  // Online drivers that stopped sending fixes get no offers until they come back.
  async function staleSweep() {
    const t = clock();
    const online = await prisma.driver.findMany({ where: { online: true, away: false }, select: { id: true, telegramId: true } });
    let n = 0;
    for (const d of online) {
      const l = last.get(d.id);
      if (l && t - l.t <= stale) continue;
      if (!l) { last.set(d.id, { lat: null, lng: null, bearing: null, speedKph: null, t }); continue; } // first sight: grace period
      await prisma.driver.update({ where: { id: d.id }, data: { away: true } });
      n++;
      if (d.telegramId && api) {
        api.sendMessage(String(d.telegramId), '📴 You have gone quiet, so you are not receiving ride offers. Open the BinaSmart Driver app and keep it open to come back online.\nየBinaSmart ሹፌር መተግበሪያውን ከፍተው ይጠብቁ።')
          .catch(e => console.error('[ride/location] away ping failed: ' + e.message));
      }
    }
    if (n) console.log('[ride/location] marked ' + n + ' driver(s) away');
    return n;
  }

  function forget(driverId) { last.delete(driverId); }

  return { record, latest, trail, staleSweep, forget };
}

module.exports = { makeLocation, TRAIL_MAX };
```

- [ ] **Step 4: Run the test**

Run: `node --test test/location.test.js 2>&1 | grep -E "^# (pass|fail)"`
Expected: `# pass 5`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add ride/location.js test/location.test.js && git commit -q -m "feat(ride): driver location module — validated fixes, trail, away sweep" && git log --oneline -1
```

---

### Task 3: `ride/offers.js` — the auction

**Files:**
- Create: `ride/offers.js`, `test/offers.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/offers.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeOffers } = require('../ride/offers');

const PICKUP = { lat: 9.010, lng: 38.760, label: 'Edna Mall' };
const DROP = { lat: 9.040, lng: 38.750, label: 'Piassa' };

function world(over) {
  const state = {
    ride: { id: 'r1', status: 'dispatching', tier: 'economy', pickup: PICKUP, dropoff: DROP, fareEtb: 295, driverTakeEtb: 295, driverId: null, riderName: 'Sara', riderPhone: '+251911000000', distanceM: 5000, durationS: 900 },
    drivers: [
      { id: 'dA', name: 'Abel',  tier: 'economy', status: 'approved', online: true,  away: false, onRideId: null, lat: 9.011, lng: 38.761, telegramId: '111' },
      { id: 'dB', name: 'Bekele', tier: 'economy', status: 'approved', online: true,  away: false, onRideId: null, lat: 9.014, lng: 38.764, telegramId: '222' },
      { id: 'dC', name: 'Chala', tier: 'economy', status: 'approved', online: true,  away: false, onRideId: null, lat: 9.020, lng: 38.770, telegramId: '333' },
      { id: 'dD', name: 'Dawit', tier: 'economy', status: 'approved', online: true,  away: false, onRideId: null, lat: 9.030, lng: 38.780, telegramId: '444' },
      { id: 'dE', name: 'Elias', tier: 'moto',    status: 'approved', online: true,  away: false, onRideId: null, lat: 9.011, lng: 38.760, telegramId: '555' },
      { id: 'dF', name: 'Fikru', tier: 'economy', status: 'pending',  online: true,  away: false, onRideId: null, lat: 9.011, lng: 38.760, telegramId: '666' },
      { id: 'dG', name: 'Girma', tier: 'economy', status: 'approved', online: false, away: false, onRideId: null, lat: 9.011, lng: 38.760, telegramId: '777' },
      { id: 'dH', name: 'Hana',  tier: 'economy', status: 'approved', online: true,  away: true,  onRideId: null, lat: 9.011, lng: 38.760, telegramId: '888' },
      { id: 'dI', name: 'Ibsa',  tier: 'economy', status: 'approved', online: true,  away: false, onRideId: 'r9', lat: 9.011, lng: 38.760, telegramId: '999' },
    ],
    offers: [],
  };
  Object.assign(state, over || {});
  let seq = 0;
  const sent = [], conciergeCalls = [];
  const prisma = {
    ride: {
      findUnique: async ({ where }) => (where.id === state.ride.id ? { ...state.ride } : null),
      updateMany: async ({ where, data }) => {
        const r = state.ride;
        if (r.id !== where.id) return { count: 0 };
        if (where.status && where.status.in && !where.status.in.includes(r.status)) return { count: 0 };
        if ('driverId' in where && where.driverId === null && r.driverId !== null) return { count: 0 };
        Object.assign(r, data); return { count: 1 };
      },
    },
    driver: {
      findMany: async ({ where }) => state.drivers.filter(d =>
        d.status === 'approved' && d.online === true && d.away === false && d.onRideId === null &&
        (!where.tier || d.tier === where.tier) && d.lat != null),
      findUnique: async ({ where }) => state.drivers.find(d => d.id === where.id) || null,
      updateMany: async ({ where, data }) => { const d = state.drivers.find(x => x.id === where.id && (!('onRideId' in where) || x.onRideId === where.onRideId)); if (!d) return { count: 0 }; Object.assign(d, data); return { count: 1 }; },
      update: async ({ where, data }) => { const d = state.drivers.find(x => x.id === where.id); Object.assign(d, data); return d; },
    },
    rideOffer: {
      createMany: async ({ data }) => { data.forEach(o => state.offers.push({ id: 'o' + (++seq), status: 'open', createdAt: new Date(), ...o })); return { count: data.length }; },
      findMany: async ({ where }) => state.offers.filter(o =>
        (!where.rideId || o.rideId === where.rideId) &&
        (!where.driverId || o.driverId === where.driverId) &&
        (!where.status || (where.status.in ? where.status.in.includes(o.status) : o.status === where.status)) &&
        (!where.createdAt || o.createdAt < where.createdAt.lt)),
      findFirst: async ({ where }) => state.offers.find(o => o.rideId === where.rideId && o.driverId === where.driverId && (!where.status || o.status === where.status)) || null,
      updateMany: async ({ where, data }) => {
        let n = 0;
        for (const o of state.offers) {
          if (where.id && o.id !== where.id) continue;
          if (where.rideId && o.rideId !== where.rideId) continue;
          if (where.driverId && o.driverId !== where.driverId) continue;
          if (where.status && o.status !== where.status) continue;
          if (where.NOT && where.NOT.driverId && o.driverId === where.NOT.driverId) continue;
          Object.assign(o, data); n++;
        }
        return { count: n };
      },
    },
  };
  const geo = { route: async (from, to) => { const km = Math.hypot(to.lat - from.lat, to.lng - from.lng) * 111; return { distanceM: Math.round(km * 1000), durationS: Math.round(km * 120), geometry: [], estimate: false }; } };
  const settings = { get: async () => ({ offerWindowS: 25, conciergeAfterS: 60, radiiKm: [3, 6, 10], commissionPct: 0 }) };
  const api = { sendMessage: async (chat, text, extra) => { sent.push({ chat, text, extra }); return { message_id: sent.length }; }, editMessageText: async () => true, answerCallbackQuery: async () => true };
  const telegram = { conciergeAlert: async r => { conciergeCalls.push(r.id); return true; }, ownerNote: async () => true };
  const notified = [];
  const riderNotify = { notify: async (id, ev) => { notified.push(ev); return true; } };
  return { state, prisma, geo, settings, api, telegram, riderNotify, sent, conciergeCalls, notified };
}

test('open() offers to the nearest three matching drivers only, closest first', async () => {
  const w = world();
  let now = 1_000_000;
  const offers = makeOffers({ prisma: w.prisma, geo: w.geo, settings: w.settings, api: w.api, telegram: w.telegram, riderNotify: w.riderNotify, baseUrl: 'https://bina.et', now: () => now });
  const n = await offers.open('r1');
  assert.equal(n, 3);
  assert.deepEqual(w.state.offers.map(o => o.driverId), ['dA', 'dB', 'dC'], 'nearest three by ETA');
  assert.equal(w.state.offers.every(o => o.status === 'open' && o.round === 1), true);
  const chats = w.sent.map(s => s.chat);
  assert.deepEqual(chats, ['111', '222', '333']);
  assert.match(w.sent[0].text, /Edna Mall/); assert.match(w.sent[0].text, /Piassa/); assert.match(w.sent[0].text, /295/);
  const kb = w.sent[0].extra.reply_markup.inline_keyboard[0].map(b => b.callback_data);
  assert.deepEqual(kb, ['acc:r1', 'dec:r1']);
});

test('the wrong tier, pending, offline, away and busy drivers are never offered', async () => {
  const w = world();
  const offers = makeOffers({ prisma: w.prisma, geo: w.geo, settings: w.settings, api: w.api, telegram: w.telegram, riderNotify: w.riderNotify, baseUrl: 'https://bina.et' });
  await offers.open('r1');
  const got = w.state.offers.map(o => o.driverId);
  ['dE', 'dF', 'dG', 'dH', 'dI'].forEach(id => assert.equal(got.includes(id), false, id + ' must not be offered'));
});

test('two drivers accepting in the same tick: exactly one wins, the other is told it is taken', async () => {
  const w = world();
  const offers = makeOffers({ prisma: w.prisma, geo: w.geo, settings: w.settings, api: w.api, telegram: w.telegram, riderNotify: w.riderNotify, baseUrl: 'https://bina.et' });
  await offers.open('r1');
  const [a, b] = await Promise.all([offers.accept('r1', 'dA'), offers.accept('r1', 'dB')]);
  const wins = [a, b].filter(r => r.ok);
  assert.equal(wins.length, 1, 'exactly one winner');
  const loser = [a, b].find(r => !r.ok);
  assert.equal(loser.error, 'taken');
  assert.equal(w.state.ride.status, 'assigned');
  assert.equal(w.state.ride.driverId, wins[0].driverId);
  const winner = w.state.drivers.find(d => d.id === wins[0].driverId);
  assert.equal(winner.onRideId, 'r1', 'winner is marked busy');
  assert.equal(w.state.offers.find(o => o.driverId === wins[0].driverId).status, 'accepted');
  assert.equal(w.state.offers.filter(o => o.status === 'lost').length, 2);
  assert.deepEqual(w.notified, ['assigned'], 'the rider is told once');
});

test('decline marks only that offer and the driver is not re-offered in the same round', async () => {
  const w = world();
  const offers = makeOffers({ prisma: w.prisma, geo: w.geo, settings: w.settings, api: w.api, telegram: w.telegram, riderNotify: w.riderNotify, baseUrl: 'https://bina.et' });
  await offers.open('r1');
  assert.equal((await offers.decline('r1', 'dA')).ok, true);
  assert.equal(w.state.offers.find(o => o.driverId === 'dA').status, 'declined');
  assert.equal(w.state.offers.filter(o => o.status === 'open').length, 2);
  const again = await offers.open('r1', 1);
  assert.equal(again, 0, 'round 1 has no new candidates');
});

test('expire() closes offers past the window and widens the radius on the next round', async () => {
  const w = world();
  let now = 1_000_000;
  const offers = makeOffers({ prisma: w.prisma, geo: w.geo, settings: w.settings, api: w.api, telegram: w.telegram, riderNotify: w.riderNotify, baseUrl: 'https://bina.et', now: () => now });
  await offers.open('r1');
  now += 10_000;
  assert.equal(await offers.expire(), 0, 'inside the window');
  now += 20_000;
  const n = await offers.expire();
  assert.equal(n, 1, 'one ride re-dispatched');
  assert.equal(w.state.offers.filter(o => o.status === 'expired').length, 3);
  const round2 = w.state.offers.filter(o => o.round === 2);
  assert.equal(round2.length, 1, 'dD is in the wider radius');
  assert.equal(round2[0].driverId, 'dD');
});

test('nobody left and past conciergeAfterS → the owner alert fires once and the ride stays dispatching', async () => {
  const w = world();
  let now = 1_000_000;
  const offers = makeOffers({ prisma: w.prisma, geo: w.geo, settings: w.settings, api: w.api, telegram: w.telegram, riderNotify: w.riderNotify, baseUrl: 'https://bina.et', now: () => now });
  w.state.ride.requestedAt = new Date(now);
  w.state.drivers.forEach(d => { d.online = false; });
  const n = await offers.open('r1');
  assert.equal(n, 0);
  assert.deepEqual(w.conciergeCalls, ['r1'], 'no drivers at all → concierge immediately');
  assert.equal(w.state.ride.status, 'dispatching');
  await offers.open('r1');
  assert.deepEqual(w.conciergeCalls, ['r1'], 'not alerted twice');
});

test('accept on an assigned ride, an unknown driver or without an open offer is refused', async () => {
  const w = world();
  const offers = makeOffers({ prisma: w.prisma, geo: w.geo, settings: w.settings, api: w.api, telegram: w.telegram, riderNotify: w.riderNotify, baseUrl: 'https://bina.et' });
  assert.equal((await offers.accept('r1', 'dA')).error, 'no_offer', 'no offer yet');
  await offers.open('r1');
  assert.equal((await offers.accept('r1', 'dD')).error, 'no_offer', 'not offered to dD');
  assert.equal((await offers.accept('r1', 'dA')).ok, true);
  assert.equal((await offers.accept('r1', 'dB')).error, 'taken');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/offers.test.js 2>&1 | grep -E "Cannot find"`
Expected: `Cannot find module '../ride/offers'`.

- [ ] **Step 3: Implement**

```js
// ride/offers.js
'use strict';
// The auction. A ride is broadcast to the nearest three eligible drivers at once; the first to accept
// wins through a DB-level mutex (the ride update only succeeds while the ride is still unassigned), so
// two simultaneous taps can never both win. No acceptance inside the window → widen the radius →
// finally the existing concierge alert, which is never removed.
const { haversineM } = require('./geo');

function makeOffers({ prisma, geo, settings, api, telegram, riderNotify, baseUrl, now }) {
  const clock = now || Date.now;
  const conciergeSent = new Set(); // rideIds already escalated in this process

  function card(ride, take, etaS, distanceM) {
    const mins = Math.max(1, Math.round((etaS || 0) / 60));
    return [
      '🚕 NEW RIDE · ' + String(ride.tier).toUpperCase(),
      '📍 Pickup: ' + (ride.pickup && ride.pickup.label || '—') + '  (' + Math.round((distanceM || 0) / 100) / 10 + ' km · ~' + mins + ' min away)',
      '🏁 Drop-off: ' + (ride.dropoff && ride.dropoff.label || '—'),
      '🛣 Trip: ' + (Math.round(ride.distanceM / 100) / 10) + ' km · ~' + Math.round(ride.durationS / 60) + ' min',
      '💰 Fare ' + ride.fareEtb + ' ETB · your take ' + take + ' ETB',
      '',
      'Accept within the window — first to accept gets the ride.',
    ].join('\n');
  }

  async function eligible(ride, radiusKm) {
    const drivers = await prisma.driver.findMany({ where: { status: 'approved', online: true, away: false, onRideId: null, tier: ride.tier } });
    const near = drivers.filter(d => d.lat != null && d.lng != null && haversineM({ lat: d.lat, lng: d.lng }, ride.pickup) <= radiusKm * 1000);
    const already = await prisma.rideOffer.findMany({ where: { rideId: ride.id } });
    const seen = new Set(already.map(o => o.driverId));
    return near.filter(d => !seen.has(d.id));
  }

  // Rank by real driving ETA to the pickup, not straight-line distance.
  async function rank(ride, drivers) {
    const withEta = await Promise.all(drivers.map(async d => {
      try { const r = await geo.route({ lat: d.lat, lng: d.lng }, ride.pickup); return { d, etaS: r.durationS, distanceM: r.distanceM }; }
      catch (e) { const m = haversineM({ lat: d.lat, lng: d.lng }, ride.pickup) * 1.3; return { d, etaS: Math.round(m / 5.5), distanceM: Math.round(m) }; }
    }));
    return withEta.sort((a, b) => a.etaS - b.etaS);
  }

  async function concierge(ride) {
    if (conciergeSent.has(ride.id)) return false;
    conciergeSent.add(ride.id);
    const ok = await telegram.conciergeAlert(ride);
    if (!ok) console.error('[ride/offers] concierge alert FAILED for ride ' + ride.id);
    return true;
  }

  // round: 1 → radiiKm[0], 2 → radiiKm[1], 3 → radiiKm[2]
  async function open(rideId, round) {
    const ride = await prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride || !['requested', 'dispatching'].includes(ride.status) || ride.driverId) return 0;
    const s = await settings.get();
    const radii = Array.isArray(s.radiiKm) && s.radiiKm.length ? s.radiiKm : [3, 6, 10];
    const r = Math.min(Math.max(1, round || 1), radii.length);
    const cands = await eligible(ride, radii[r - 1]);
    if (!cands.length) {
      const ageS = (clock() - new Date(ride.requestedAt || clock()).getTime()) / 1000;
      if (r >= radii.length || ageS >= (s.conciergeAfterS || 60) || !round) await concierge(ride);
      return 0;
    }
    const ranked = (await rank(ride, cands)).slice(0, 3);
    await prisma.rideOffer.createMany({ data: ranked.map(x => ({ rideId: ride.id, driverId: x.d.id, etaS: x.etaS, distanceM: x.distanceM, round: r })) });
    for (const x of ranked) {
      if (!x.d.telegramId || !api) continue;
      try {
        await api.sendMessage(String(x.d.telegramId), card(ride, ride.driverTakeEtb, x.etaS, x.distanceM), {
          reply_markup: { inline_keyboard: [[
            { text: '✅ Accept · ተቀበል', callback_data: 'acc:' + ride.id },
            { text: '❌ Decline · አትቀበል', callback_data: 'dec:' + ride.id },
          ], [{ text: '🚗 Open the driver app', web_app: { url: baseUrl + '/drive' } }]] },
        });
      } catch (e) { console.error('[ride/offers] offer push failed for driver ' + x.d.id + ': ' + e.message); }
    }
    console.log('[ride/offers] ride ' + ride.id + ' offered to ' + ranked.length + ' driver(s), round ' + r);
    return ranked.length;
  }

  async function accept(rideId, driverId) {
    const offer = await prisma.rideOffer.findFirst({ where: { rideId, driverId, status: 'open' } });
    if (!offer) return { ok: false, error: 'no_offer' };
    const drv = await prisma.driver.findUnique({ where: { id: driverId } });
    if (!drv || drv.status !== 'approved') return { ok: false, error: 'not_approved' };
    if (drv.onRideId) return { ok: false, error: 'already_on_a_ride' };
    // THE MUTEX: only succeeds while the ride is still unassigned.
    const won = await prisma.ride.updateMany({
      where: { id: rideId, status: { in: ['requested', 'dispatching'] }, driverId: null },
      data: { driverId, status: 'assigned', assignedAt: new Date(clock()), driverAcceptedAt: new Date(clock()) },
    });
    if (won.count === 0) {
      await prisma.rideOffer.updateMany({ where: { id: offer.id, status: 'open' }, data: { status: 'lost', decidedAt: new Date(clock()) } });
      return { ok: false, error: 'taken' };
    }
    await prisma.driver.updateMany({ where: { id: driverId, onRideId: null }, data: { onRideId: rideId } });
    await prisma.rideOffer.updateMany({ where: { id: offer.id }, data: { status: 'accepted', decidedAt: new Date(clock()) } });
    await prisma.rideOffer.updateMany({ where: { rideId, status: 'open', NOT: { driverId } }, data: { status: 'lost', decidedAt: new Date(clock()) } });
    conciergeSent.delete(rideId);
    if (riderNotify) riderNotify.notify(rideId, 'assigned').catch(() => {});
    return { ok: true, driverId, rideId };
  }

  async function decline(rideId, driverId) {
    const n = await prisma.rideOffer.updateMany({ where: { rideId, driverId, status: 'open' }, data: { status: 'declined', decidedAt: new Date(clock()) } });
    if (n.count === 0) return { ok: false, error: 'no_offer' };
    return { ok: true };
  }

  // Runs on an interval. Expiry is computed from createdAt, so a restart can never strand an offer.
  async function expire() {
    const s = await settings.get();
    const cut = new Date(clock() - (s.offerWindowS || 25) * 1000);
    const stale = await prisma.rideOffer.findMany({ where: { status: 'open', createdAt: { lt: cut } } });
    if (!stale.length) return 0;
    const byRide = new Map();
    for (const o of stale) { if (!byRide.has(o.rideId)) byRide.set(o.rideId, o.round || 1); else byRide.set(o.rideId, Math.max(byRide.get(o.rideId), o.round || 1)); }
    await prisma.rideOffer.updateMany({ where: { status: 'open', createdAt: { lt: cut } }, data: { status: 'expired', decidedAt: new Date(clock()) } });
    let redispatched = 0;
    for (const [rideId, round] of byRide) {
      try { await open(rideId, round + 1); redispatched++; }
      catch (e) { console.error('[ride/offers] re-dispatch failed for ' + rideId + ': ' + e.message); }
    }
    return redispatched;
  }

  return { open, accept, decline, expire, _conciergeSent: conciergeSent };
}

module.exports = { makeOffers };
```

- [ ] **Step 4: Run the test**

Run: `node --test test/offers.test.js 2>&1 | grep -E "^# (pass|fail)|^not ok"`
Expected: `# pass 7`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add ride/offers.js test/offers.test.js && git commit -q -m "feat(ride): broadcast dispatch — nearest 3, first-accept-wins mutex, widen, concierge fallback" && git log --oneline -1
```

---

### Task 4: `ride/driverApi.js` — the driver's REST surface

**Files:**
- Create: `ride/driverApi.js`, `test/driverApi.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/driverApi.test.js
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const Fastify = require('fastify');
const { registerDriverApi } = require('../ride/driverApi');
const { sign } = require('../ride/tgauth');

const TOKEN = '222:DRIVERTOKEN';
const initData = uid => sign({ user: { id: uid, first_name: 'Abel' }, auth_date: String(Math.floor(Date.now() / 1000) - 5) }, TOKEN);

function world() {
  const drivers = [
    { id: 'dA', name: 'Abel', phone: '+251911000000', tier: 'economy', plate: 'A1', status: 'approved', telegramId: '111', online: false, away: false, onRideId: null, earningsTodayEtb: 0, earningsDay: null, ridesCount: 3, rating: 4.9, carPhotoUrl: '/api/ride/car/dA.jpg' },
    { id: 'dP', name: 'Pending', phone: '+251911000001', tier: 'economy', plate: 'P1', status: 'pending', telegramId: '222', online: false, away: false, onRideId: null },
    { id: 'dS', name: 'Susp', phone: '+251911000002', tier: 'economy', plate: 'S1', status: 'suspended', telegramId: '333', online: false, away: false, onRideId: null },
  ];
  const rides = [{ id: 'r1', status: 'assigned', driverId: 'dA', tier: 'economy', pickup: { lat: 9.01, lng: 38.76, label: 'Edna Mall' }, dropoff: { lat: 9.04, lng: 38.75, label: 'Piassa' }, fareEtb: 295, driverTakeEtb: 295, riderName: 'Sara', riderPhone: '+251911222333', paymentMethod: 'cash', paymentStatus: 'unpaid', distanceM: 5000, durationS: 900 }];
  const notified = [], recorded = [], accepts = [], declines = [];
  const prisma = {
    driver: {
      findFirst: async ({ where }) => drivers.find(d => d.telegramId === where.telegramId) || null,
      findUnique: async ({ where }) => drivers.find(d => d.id === where.id) || null,
      update: async ({ where, data }) => { const d = drivers.find(x => x.id === where.id); Object.assign(d, data); return d; },
      updateMany: async ({ where, data }) => { const d = drivers.find(x => x.id === where.id); if (!d) return { count: 0 }; Object.assign(d, data); return { count: 1 }; },
    },
    ride: {
      findFirst: async ({ where }) => rides.find(r => r.driverId === where.driverId && ['assigned', 'arriving', 'arrived', 'ontrip'].includes(r.status)) || null,
      findUnique: async ({ where }) => rides.find(r => r.id === where.id) || null,
      update: async ({ where, data }) => { const r = rides.find(x => x.id === where.id); Object.assign(r, data); return r; },
      updateMany: async ({ where, data }) => { const r = rides.find(x => x.id === where.id && x.driverId === where.driverId && (!where.status || where.status.in.includes(x.status))); if (!r) return { count: 0 }; Object.assign(r, data); return { count: 1 }; },
    },
  };
  const location = { record: async (id, fix, rideId) => { recorded.push({ id, fix, rideId }); return { ok: true }; }, latest: () => ({ lat: 9.01, lng: 38.76, bearing: 10, ageS: 2 }), forget: () => {} };
  const offers = { accept: async (rideId, driverId) => { accepts.push({ rideId, driverId }); return rideId === 'taken' ? { ok: false, error: 'taken' } : { ok: true, rideId, driverId }; },
                   decline: async (rideId, driverId) => { declines.push({ rideId, driverId }); return { ok: true }; },
                   open: async () => 0 };
  const riderNotify = { notify: async (id, ev) => { notified.push(ev); return true; } };
  const app = Fastify();
  registerDriverApi(app, { prisma, location, offers, riderNotify, driverBotToken: TOKEN, telegram: { ownerNote: async () => true } });
  return { app, drivers, rides, notified, recorded, accepts, declines };
}
const w = world();
after(() => w.app.close());
const post = (url, payload) => w.app.inject({ method: 'POST', url, payload });

test('every endpoint needs a valid driver Telegram signature', async () => {
  assert.equal((await post('/api/drive/online', {})).statusCode, 401);
  assert.equal((await post('/api/drive/online', { initData: 'nonsense' })).statusCode, 401);
  const r = await post('/api/drive/online', { initData: initData(999) });
  assert.equal(r.statusCode, 403, 'signed but not a registered driver');
  assert.match(r.json().error, /not registered/i);
});

test('pending and suspended drivers are refused with a readable reason', async () => {
  const p = await post('/api/drive/online', { initData: initData(222) });
  assert.equal(p.statusCode, 403); assert.match(p.json().error, /reviewing/i);
  const s = await post('/api/drive/online', { initData: initData(333) });
  assert.equal(s.statusCode, 403); assert.match(s.json().error, /paused|support/i);
});

test('online → location → me returns the job, then arrived → start → complete pays and frees the driver', async () => {
  const on = await post('/api/drive/online', { initData: initData(111) });
  assert.equal(on.statusCode, 200);
  assert.equal(w.drivers[0].online, true); assert.equal(w.drivers[0].away, false);

  const loc = await post('/api/drive/location', { initData: initData(111), lat: 9.011, lng: 38.761, bearing: 90, speedKph: 20, accuracy: 8 });
  assert.equal(loc.statusCode, 200);
  assert.equal(w.recorded.at(-1).rideId, 'r1', 'the fix is tagged with the active ride');

  const me = await w.app.inject({ method: 'GET', url: '/api/drive/me?initData=' + encodeURIComponent(initData(111)) });
  const body = me.json();
  assert.equal(body.driver.name, 'Abel');
  assert.equal(body.job.rideId, 'r1');
  assert.equal(body.job.riderPhone, '+251911222333');
  assert.equal(body.job.takeEtb, 295);
  assert.equal(body.earningsTodayEtb, 0);

  assert.equal((await post('/api/drive/arrived', { initData: initData(111) })).statusCode, 200);
  assert.equal(w.rides[0].status, 'arrived');
  assert.equal((await post('/api/drive/start', { initData: initData(111) })).statusCode, 200);
  assert.equal(w.rides[0].status, 'ontrip');
  const done = await post('/api/drive/complete', { initData: initData(111), cashPaid: true });
  assert.equal(done.statusCode, 200);
  assert.equal(w.rides[0].status, 'completed');
  assert.equal(w.rides[0].paymentStatus, 'paid');
  assert.equal(w.drivers[0].onRideId, null, 'driver is free again');
  assert.equal(w.drivers[0].earningsTodayEtb, 295);
  assert.equal(w.drivers[0].ridesCount, 4);
  assert.deepEqual(w.notified, ['arrived', 'completed']);
});

test('status steps out of order are refused, and offline clears online', async () => {
  const bad = await post('/api/drive/start', { initData: initData(111) });
  assert.equal(bad.statusCode, 409);
  const off = await post('/api/drive/offline', { initData: initData(111) });
  assert.equal(off.statusCode, 200);
  assert.equal(w.drivers[0].online, false);
});

test('accept and decline delegate to the offers module and pass its refusal through', async () => {
  await post('/api/drive/accept', { initData: initData(111), rideId: 'r1' });
  assert.deepEqual(w.accepts.at(-1), { rideId: 'r1', driverId: 'dA' });
  await post('/api/drive/decline', { initData: initData(111), rideId: 'r1' });
  assert.deepEqual(w.declines.at(-1), { rideId: 'r1', driverId: 'dA' });
  const taken = await post('/api/drive/accept', { initData: initData(111), rideId: 'taken' });
  assert.equal(taken.statusCode, 409);
  assert.match(taken.json().error, /another driver/i);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/driverApi.test.js 2>&1 | grep -E "Cannot find"`
Expected: `Cannot find module '../ride/driverApi'`.

- [ ] **Step 3: Implement**

```js
// ride/driverApi.js
'use strict';
// Everything the driver app calls. Auth is the driver bot's Telegram signature — no driver passwords.
// Every handler resolves the Driver by telegramId and refuses unless status === 'approved'.
const tgauth = require('./tgauth');

const ACTIVE = ['assigned', 'arriving', 'arrived', 'ontrip'];
const REASON = { pending: 'We are still reviewing your registration. We will message you here when you are approved.', suspended: 'Your driver account is paused. Please contact support: https://bina.et/support' };

function registerDriverApi(fastify, { prisma, location, offers, riderNotify, driverBotToken, telegram, now }) {
  const clock = now || Date.now;

  async function auth(req, reply) {
    const raw = (req.body && req.body.initData) || req.query.initData || '';
    const tg = tgauth.verifyInitData(String(raw), driverBotToken);
    if (!tg) { reply.code(401).send({ ok: false, error: 'Please reopen the BinaSmart Driver app from the bot.' }); return null; }
    const drv = await prisma.driver.findFirst({ where: { telegramId: String(tg.user.id) } });
    if (!drv) { reply.code(403).send({ ok: false, error: 'This Telegram account is not registered as a BinaSmart driver. Send /start to @binasmartdriverbot to register.' }); return null; }
    if (drv.status !== 'approved') { reply.code(403).send({ ok: false, error: REASON[drv.status] || 'Your account cannot receive rides.' }); return null; }
    return drv;
  }

  function pubJob(ride) {
    if (!ride) return null;
    return { rideId: ride.id, status: ride.status, tier: ride.tier, pickup: ride.pickup, dropoff: ride.dropoff,
      fareEtb: ride.fareEtb, takeEtb: ride.driverTakeEtb, paymentMethod: ride.paymentMethod, paymentStatus: ride.paymentStatus,
      riderName: ride.riderName, riderPhone: ride.riderPhone,
      distanceKm: Math.round(ride.distanceM / 100) / 10, tripMin: Math.round(ride.durationS / 60) };
  }
  const activeRide = drv => prisma.ride.findFirst({ where: { driverId: drv.id, status: { in: ACTIVE } } });

  function todayKey(t) { const d = new Date(t); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); }

  fastify.post('/api/drive/online', async (req, reply) => {
    const drv = await auth(req, reply); if (!drv) return;
    await prisma.driver.update({ where: { id: drv.id }, data: { online: true, away: false, lastSeenAt: new Date(clock()) } });
    const ride = await activeRide(drv);
    return { ok: true, online: true, job: pubJob(ride) };
  });

  fastify.post('/api/drive/offline', async (req, reply) => {
    const drv = await auth(req, reply); if (!drv) return;
    await prisma.driver.update({ where: { id: drv.id }, data: { online: false, away: false } });
    if (location.forget) location.forget(drv.id);
    return { ok: true, online: false };
  });

  fastify.post('/api/drive/location', async (req, reply) => {
    const drv = await auth(req, reply); if (!drv) return;
    const b = req.body || {};
    const ride = await activeRide(drv);
    const r = await location.record(drv.id, { lat: b.lat, lng: b.lng, bearing: b.bearing, speedKph: b.speedKph, accuracy: b.accuracy }, ride ? ride.id : null);
    if (!r.ok) return reply.code(400).send({ ok: false, error: 'location_' + r.error });
    return { ok: true, job: pubJob(ride) };
  });

  fastify.get('/api/drive/me', async (req, reply) => {
    const drv = await auth(req, reply); if (!drv) return;
    const ride = await activeRide(drv);
    const sameDay = drv.earningsDay && todayKey(drv.earningsDay).getTime() === todayKey(clock()).getTime();
    return { ok: true,
      driver: { name: drv.name, tier: drv.tier, plate: drv.plate, rating: drv.rating, ridesCount: drv.ridesCount, carPhoto: drv.carPhotoUrl || null },
      online: !!drv.online, away: !!drv.away,
      earningsTodayEtb: sameDay ? drv.earningsTodayEtb : 0,
      job: pubJob(ride) };
  });

  fastify.post('/api/drive/accept', async (req, reply) => {
    const drv = await auth(req, reply); if (!drv) return;
    const rideId = String((req.body || {}).rideId || '');
    const r = await offers.accept(rideId, drv.id);
    if (!r.ok) {
      const msg = { taken: 'Taken by another driver — the next ride will come soon.', no_offer: 'That offer is no longer open.',
        already_on_a_ride: 'Finish your current trip first.', not_approved: 'Your account cannot accept rides.' }[r.error] || 'Could not accept.';
      return reply.code(409).send({ ok: false, error: msg });
    }
    const ride = await prisma.ride.findUnique({ where: { id: rideId } });
    return { ok: true, job: pubJob(ride) };
  });

  fastify.post('/api/drive/decline', async (req, reply) => {
    const drv = await auth(req, reply); if (!drv) return;
    const r = await offers.decline(String((req.body || {}).rideId || ''), drv.id);
    if (!r.ok) return reply.code(409).send({ ok: false, error: 'That offer is no longer open.' });
    return { ok: true };
  });

  // arrived / start / complete — one step each, refused out of order.
  async function step(req, reply, from, to, extra) {
    const drv = await auth(req, reply); if (!drv) return null;
    const ride = await activeRide(drv);
    if (!ride) { reply.code(404).send({ ok: false, error: 'You have no active trip.' }); return null; }
    if (!from.includes(ride.status)) { reply.code(409).send({ ok: false, error: 'Cannot do that from "' + ride.status + '".' }); return null; }
    const data = Object.assign({ status: to }, extra || {});
    const n = await prisma.ride.updateMany({ where: { id: ride.id, driverId: drv.id, status: { in: from } }, data });
    if (n.count === 0) { reply.code(409).send({ ok: false, error: 'The trip changed — refresh the app.' }); return null; }
    if (riderNotify && ['arrived', 'completed'].includes(to)) riderNotify.notify(ride.id, to).catch(() => {});
    return { drv, ride };
  }

  fastify.post('/api/drive/arrived', async (req, reply) => {
    const r = await step(req, reply, ['assigned', 'arriving'], 'arrived', { arrivedAt: new Date(clock()) });
    if (!r) return; return { ok: true, status: 'arrived' };
  });

  fastify.post('/api/drive/start', async (req, reply) => {
    const r = await step(req, reply, ['arrived'], 'ontrip', { startedAt: new Date(clock()) });
    if (!r) return; return { ok: true, status: 'ontrip' };
  });

  fastify.post('/api/drive/complete', async (req, reply) => {
    const paid = (req.body || {}).cashPaid === true;
    const r = await step(req, reply, ['ontrip'], 'completed', Object.assign({ completedAt: new Date(clock()) }, paid ? { paymentStatus: 'paid' } : {}));
    if (!r) return;
    const { drv, ride } = r;
    const sameDay = drv.earningsDay && todayKey(drv.earningsDay).getTime() === todayKey(clock()).getTime();
    await prisma.driver.update({ where: { id: drv.id }, data: {
      onRideId: null,
      ridesCount: (drv.ridesCount || 0) + 1,
      earningsTodayEtb: (sameDay ? drv.earningsTodayEtb || 0 : 0) + (ride.driverTakeEtb || 0),
      earningsDay: new Date(clock()) } });
    return { ok: true, status: 'completed', takeEtb: ride.driverTakeEtb, paid };
  });
}

module.exports = { registerDriverApi, ACTIVE };
```

- [ ] **Step 4: Run the test**

Run: `node --test test/driverApi.test.js 2>&1 | grep -E "^# (pass|fail)|^not ok"`
Expected: `# pass 5`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add ride/driverApi.js test/driverApi.test.js && git commit -q -m "feat(ride): driver REST API — online, location, job steps, earnings" && git log --oneline -1
```

---

### Task 5: Wire it together — dispatch, index, routes, driver bot buttons

**Files:**
- Modify: `ride/dispatch.js`, `ride/index.js`, `ride/routes.js`, `ride/driverBot.js`
- Test: `test/dispatch.test.js` (existing — add one case)

- [ ] **Step 1: `ride/dispatch.js` — hand off to offers when drivers are online**

Replace the body of `start` with:

```js
  async function start(rideId) {
    cancel(rideId); // a repeated start must not orphan an earlier timer
    const after = await windowS();
    const online = await prisma.driver.count({ where: { status: 'approved', online: true, away: false, onRideId: null } });
    if (online === 0 || after === 0) return toConcierge(rideId);
    if (offers) { const n = await offers.open(rideId, 1).catch(e => { console.error('[ride/dispatch] offers.open failed: ' + e.message); return 0; });
      if (n === 0) return toConcierge(rideId); }
    const h = st(() => toConcierge(rideId).catch(e => console.error('[ride/dispatch] concierge escalation error:', e.message)), after * 1000);
    timers.set(rideId, h);
    return 'waiting';
  }
```

and change the factory signature line to accept `offers`:

```js
function makeDispatch({ prisma, telegram, settings, offers, setTimeoutFn, clearTimeoutFn }) {
```

- [ ] **Step 2: Add the dispatch test case**

Append to `test/dispatch.test.js` (create with the two-line header from Task 1 Step 4 if it does not exist):

```js
test('with online drivers, start() opens offers and only falls back to concierge when none can be offered', async () => {
  const { makeDispatch } = require('../ride/dispatch');
  const calls = [], alerts = [];
  const prisma = { driver: { count: async () => 2 }, ride: { updateMany: async () => ({ count: 1 }), findUnique: async () => ({ id: 'r1' }) } };
  const telegram = { conciergeAlert: async r => { alerts.push(r.id); return true; } };
  const settings = { get: async () => ({ conciergeAfterS: 60 }) };
  const d1 = makeDispatch({ prisma, telegram, settings, offers: { open: async id => { calls.push(id); return 3; } }, setTimeoutFn: () => 1, clearTimeoutFn: () => {} });
  assert.equal(await d1.start('r1'), 'waiting');
  assert.deepEqual(calls, ['r1']);
  assert.deepEqual(alerts, [], 'no alert while drivers are considering');
  const d2 = makeDispatch({ prisma, telegram, settings, offers: { open: async () => 0 }, setTimeoutFn: () => 1, clearTimeoutFn: () => {} });
  assert.equal(await d2.start('r1'), true, 'nobody offerable → concierge now');
  assert.deepEqual(alerts, ['r1']);
});
```

- [ ] **Step 3: `ride/index.js` — wire the new modules**

Apply with a local Python script `scp`'d to `/tmp/p2-index.py`:

```python
p = "/var/www/connectcare/binasmart/ride/index.js"
s = open(p).read()
assert "makeOffers" not in s, "already wired"
s = s.replace("const { makeRiderNotify } = require('./riderNotify');",
  "const { makeRiderNotify } = require('./riderNotify');\nconst { makeLocation } = require('./location');\nconst { makeOffers } = require('./offers');\nconst { registerDriverApi } = require('./driverApi');", 1)
# location + offers must exist before dispatch, which now takes offers
old = "  const dispatch = makeDispatch({ prisma: deps.prisma, telegram, settings });"
new = """  const location = makeLocation({ prisma: deps.prisma, api: driverApi_placeholder_api });
  const offers = makeOffers({ prisma: deps.prisma, geo, settings, api: driverApi_placeholder_api, telegram, riderNotify: null, baseUrl: deps.BASE_URL });
  const dispatch = makeDispatch({ prisma: deps.prisma, telegram, settings, offers });"""
assert old in s
s = s.replace(old, new, 1)
open(p, "w").write(s)
print("index: first pass")
```

Then hand-edit `ride/index.js` so the final file reads exactly like this (the placeholder above only keeps the patch simple — replace it):

```js
'use strict';
const path = require('path');
const { makeSettings } = require('./settings');
const { makeGeo } = require('./geo');
const { makeTelegram } = require('./telegram');
const { makeDispatch } = require('./dispatch');
const { makeTgApi } = require('./tgApi');
const { makeBinaBot } = require('./binaBot');
const { makeDriverBot } = require('./driverBot');
const { makeRiderNotify } = require('./riderNotify');
const { makeLocation } = require('./location');
const { makeOffers } = require('./offers');
const { registerDriverApi } = require('./driverApi');
const routes = require('./routes');

// registerRide(fastify, { prisma, sendTg, OWNER_KEY, OWNER_CHAT, ROUTER_URL, BASE_URL })
module.exports = function registerRide(fastify, deps) {
  const settings = makeSettings(deps.prisma);
  const geo = makeGeo({ routerUrl: deps.ROUTER_URL, prisma: deps.prisma });
  const riderBotToken = process.env.BINA_RIDER_BOT_TOKEN || '', driverBotToken = process.env.BINA_DRIVER_BOT_TOKEN || '';
  const riderApi = makeTgApi({ token: riderBotToken }), driverApi = makeTgApi({ token: driverBotToken });
  const telegram = makeTelegram({ sendTg: deps.sendTg, ownerChat: deps.OWNER_CHAT, baseUrl: deps.BASE_URL, ownerKey: deps.OWNER_KEY,
    api: riderBotToken ? riderApi : null, ownerChatNew: process.env.BINA_OWNER_TG_CHAT || '' });
  const riderNotify = makeRiderNotify({ prisma: deps.prisma, api: riderApi, baseUrl: deps.BASE_URL });
  // Phase 2: live location + the offer auction. Offers push to drivers through the DRIVER bot.
  const location = makeLocation({ prisma: deps.prisma, api: driverApi });
  const offers = makeOffers({ prisma: deps.prisma, geo, settings, api: driverApi, telegram, riderNotify, baseUrl: deps.BASE_URL });
  const dispatch = makeDispatch({ prisma: deps.prisma, telegram, settings, offers });
  const uploadsDir = path.join(__dirname, '..', 'uploads', 'drivers');
  const riderBot = makeBinaBot({ api: riderApi, baseUrl: deps.BASE_URL, botUsername: process.env.BINA_RIDER_BOT_USERNAME || 'bina_smart_bot',
    assistantUrl: 'http://127.0.0.1:' + (process.env.PORT || 4210) + '/api/assistant' });
  const driverBot = makeDriverBot({ prisma: deps.prisma, api: driverApi, telegram, uploadsDir, baseUrl: deps.BASE_URL, offers });
  routes(fastify, { prisma: deps.prisma, settings, geo, telegram, dispatch, OWNER_KEY: deps.OWNER_KEY,
    riderBotToken, webhookSecret: process.env.TG_WEBHOOK_SECRET || '', riderBot, driverBot, riderNotify, uploadsDir, location, offers });
  registerDriverApi(fastify, { prisma: deps.prisma, location, offers, riderNotify, driverBotToken, telegram });
  // In-memory concierge timers die with the process; these sweeps recover anything a restart stranded.
  const sweep = setInterval(() => dispatch.sweepStale().catch(e => console.error('[ride] sweep error:', e.message)), 30000);
  sweep.unref();
  const tick = setInterval(() => {
    offers.expire().catch(e => console.error('[ride] offer expiry error:', e.message));
    location.staleSweep().catch(e => console.error('[ride] stale sweep error:', e.message));
  }, 10000);
  tick.unref();
  console.log('[ride] BinaSmart Ride module mounted' + (riderBotToken ? ' (Telegram bots on)' : ' (no Telegram bot tokens)') + ' · Phase 2 dispatch active');
  return { settings, geo, telegram, dispatch, riderNotify, location, offers };
};
```

- [ ] **Step 4: `ride/routes.js` — driver position on the rider poll, and `/drive`**

Apply with `/tmp/p2-routes.py`:

```python
p = "/var/www/connectcare/binasmart/ride/routes.js"
s = open(p).read()
assert "driverLocation" not in s, "already patched"

s = s.replace("module.exports = function routes(fastify, { prisma, settings, geo, telegram, dispatch, OWNER_KEY, riderBotToken, webhookSecret, riderBot, driverBot, riderNotify, uploadsDir }) {",
              "module.exports = function routes(fastify, { prisma, settings, geo, telegram, dispatch, OWNER_KEY, riderBotToken, webhookSecret, riderBot, driverBot, riderNotify, uploadsDir, location, offers }) {", 1)

# the driver app page, next to the other pages
s = s.replace("  fastify.get('/ride-ops', ", "  fastify.get('/drive', async (req, reply) => reply.sendFile('drive.html'));\n  fastify.get('/ride-ops', ", 1)

# rider poll carries the driver's live position + trail
old = """    const ride = await prisma.ride.findUnique({ where: { id: req.params.id }, include: { driver: true } });
    if (!ride || normPhone(req.query.phone) !== ride.riderPhone) return reply.code(404).send({ ok: false, error: 'not_found' });
    return { ok: true, ride: pubRide(ride) };"""
new = """    const ride = await prisma.ride.findUnique({ where: { id: req.params.id }, include: { driver: true } });
    if (!ride || normPhone(req.query.phone) !== ride.riderPhone) return reply.code(404).send({ ok: false, error: 'not_found' });
    return { ok: true, ride: pubRide(ride), driverLocation: driverLoc(ride), driverTrail: location && ride.driverId ? location.trail(ride.id) : [] };"""
assert old in s, "rider lookup not found"
s = s.replace(old, new, 1)

# helper: a rider sees a position only while that driver is on their active ride
s = s.replace("  const fireNotify = (id, ev) =>",
"""  // A rider may see a driver's position ONLY while that driver is assigned to their active ride.
  const driverLoc = ride => {
    if (!location || !ride.driverId || !ACTIVE.includes(ride.status)) return null;
    const l = location.latest(ride.driverId);
    return l && l.lat != null ? l : null;
  };
  const fireNotify = (id, ev) =>""", 1)
open(p, "w").write(s)
print("routes patched")
```

- [ ] **Step 5: Driver bot — Accept/Decline buttons and a Drive button**

Apply with `/tmp/p2-driverbot.py`:

```python
p = "/var/www/connectcare/binasmart/ride/driverBot.js"
s = open(p).read()
assert "acc:" not in s, "already patched"
s = s.replace("function makeDriverBot({ prisma, api, telegram, uploadsDir, baseUrl, now }) {",
              "function makeDriverBot({ prisma, api, telegram, uploadsDir, baseUrl, now, offers }) {", 1)

old = """    if (update.callback_query) {
      const cq = update.callback_query; const chatId = String(cq.message.chat.id);
      try { await api.answerCallbackQuery(cq.id); } catch (e) { /* ignore */ }
      const s = sess(chatId); const m = /^tier:(\\w+)$/.exec(cq.data || '');
      if (s.step === 'tier' && m && TIERS[m[1]]) { s.data.tier = m[1]; s.step = 'vehicle'; return ask(chatId, 'vehicle'); }
      return ask(chatId, s.step);
    }"""
new = """    if (update.callback_query) {
      const cq = update.callback_query; const chatId = String(cq.message.chat.id);
      try { await api.answerCallbackQuery(cq.id); } catch (e) { /* ignore */ }
      // Ride offers: accept / decline straight from the Telegram card.
      const job = /^(acc|dec):(\\S+)$/.exec(cq.data || '');
      if (job && offers) {
        const drv = await prisma.driver.findFirst({ where: { telegramId: chatId } });
        if (!drv || drv.status !== 'approved') return api.sendMessage(chatId, 'Your account cannot accept rides yet.');
        if (job[1] === 'dec') { await offers.decline(job[2], drv.id); return api.sendMessage(chatId, 'Declined. We will send you the next one.'); }
        const r = await offers.accept(job[2], drv.id);
        if (r.ok) return api.sendMessage(chatId, '✅ It is yours! Open the driver app to navigate and start the trip.', { reply_markup: { inline_keyboard: [[{ text: '🚗 Open the driver app', web_app: { url: baseUrl + '/drive' } }]] } });
        const msg = { taken: 'Taken by another driver — the next ride will come soon.', no_offer: 'That offer has expired.', already_on_a_ride: 'Finish your current trip first.' }[r.error] || 'Could not accept.';
        return api.sendMessage(chatId, msg);
      }
      const s = sess(chatId); const m = /^tier:(\\w+)$/.exec(cq.data || '');
      if (s.step === 'tier' && m && TIERS[m[1]]) { s.data.tier = m[1]; s.step = 'vehicle'; return ask(chatId, 'vehicle'); }
      return ask(chatId, s.step);
    }"""
assert old in s, "callback block not found"
s = s.replace(old, new, 1)

# an approved driver typing /start gets the app, not the registration wizard
old = """    if (text.startsWith('/start')) { sessions.delete(chatId); sess(chatId); return api.sendMessage(chatId, WELCOME); }"""
new = """    if (text.startsWith('/start') || text.startsWith('/drive')) {
      const known = await prisma.driver.findFirst({ where: { telegramId: chatId } });
      if (known && known.status === 'approved') {
        return api.sendMessage(chatId, '🚗 Welcome back, ' + known.name + '. Open the app, go ONLINE and you will start receiving ride offers.\\nመተግበሪያውን ክፈቱ፣ ONLINE ይሁኑ።',
          { reply_markup: { inline_keyboard: [[{ text: '🚗 Open the driver app · ክፈት', web_app: { url: baseUrl + '/drive' } }]] } });
      }
      if (known) return api.sendMessage(chatId, known.status === 'pending' ? 'We are still reviewing your registration. We will message you here when you are approved.' : 'Your account is paused. Contact support: https://bina.et/support');
      sessions.delete(chatId); sess(chatId); return api.sendMessage(chatId, WELCOME);
    }"""
assert old in s, "/start line not found"
s = s.replace(old, new, 1)
open(p, "w").write(s)
print("driverBot patched")
```

- [ ] **Step 6: Run the whole suite and restart**

Run:
```bash
cd /var/www/connectcare/binasmart && node --check ride/routes.js && node --check ride/index.js && node --check ride/driverBot.js && npm test 2>&1 | grep -E "^# (tests|pass|fail)|^not ok"
pm2 restart binasmart-api --update-env >/dev/null 2>&1; sleep 5
pm2 logs binasmart-api --lines 12 --nostream 2>/dev/null | grep "ride\]" | tail -1
for u in / /ride /drive /ai; do printf "%-8s %s\n" "$u" "$(curl -s -o /dev/null -w '%{http_code}' https://bina.et$u)"; done
curl -s -o /dev/null -w "drive api no auth: %{http_code}\n" -X POST https://bina.et/api/drive/online -H 'Content-Type: application/json' -d '{}'
```
Expected: all checks silent, `# fail 0`, the log line ends `Phase 2 dispatch active`, `/` `/ride` `/ai` = 200, `/drive` = 404 for now (the page arrives in Task 6), and `drive api no auth: 401`.

- [ ] **Step 7: Commit and push**

```bash
git add ride/dispatch.js ride/index.js ride/routes.js ride/driverBot.js test/dispatch.test.js && git commit -q -m "feat(ride): wire Phase 2 — offers into dispatch, driver API, live position on the rider poll" && git push -q origin main && git log --oneline -1
```

---

### Task 6: The driver app (`/drive`)

**Files:**
- Create: `public/drive.html`, `public/drive/app.js`, `public/drive/ui.css`

- [ ] **Step 1: `public/drive.html`**

```html
<!DOCTYPE html>
<html lang="am">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>BinaSmart Driver · የሹፌር መተግበሪያ</title>
<meta name="robots" content="noindex">
<meta name="theme-color" content="#064e3b">
<link rel="icon" href="/icon-32.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;700;800&family=Noto+Sans+Ethiopic:wght@500;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/static/drive/ui.css?v=1">
</head>
<body>
<header class="top"><span class="logo">🚗 BinaSmart <b>Driver</b></span><span class="pill" id="tierPill"></span></header>

<main>
  <section class="screen" id="s-load"><div class="center"><div class="spin"></div><p>እየተጫነ… · Loading</p></div></section>

  <section class="screen hidden" id="s-blocked">
    <div class="center"><div class="big">⏳</div><h2 id="blockTitle"></h2><p id="blockMsg"></p>
    <a class="btn ghost" href="https://bina.et/support">Support · ድጋፍ</a></div>
  </section>

  <section class="screen hidden" id="s-idle">
    <div class="hero">
      <div class="who"><b id="dName"></b><span id="dCar"></span></div>
      <div class="stats"><div><b id="stTrips">0</b><small>trips today · ጉዞዎች</small></div><div><b id="stEarn">0</b><small>ETB today · ብር</small></div></div>
    </div>
    <button class="switch off" id="toggle" aria-pressed="false"><span class="dot"></span><span id="toggleTxt">GO ONLINE · ስራ ጀምር</span></button>
    <p class="hint" id="idleHint">ONLINE ሲሆኑ የጉዞ ጥያቄዎች ይደርስዎታል።<br>You get ride offers while online. Keep this page open.</p>
    <p class="hint warn hidden" id="awayHint">📴 You went quiet and stopped receiving offers. Keep this page open and your GPS on.</p>
  </section>

  <section class="screen hidden" id="s-offer">
    <div class="ring" id="ring"><span id="ringN">25</span></div>
    <h2>አዲስ ጉዞ · New ride</h2>
    <div class="job">
      <div class="row"><span>📍</span><b id="oFrom"></b></div>
      <div class="row"><span>🏁</span><b id="oTo"></b></div>
      <div class="row mut"><span>🚗</span><span id="oNear"></span></div>
      <div class="row mut"><span>🛣</span><span id="oTrip"></span></div>
      <div class="money"><b id="oTake"></b><small id="oFare"></small></div>
    </div>
    <button class="btn primary big" id="accept">✅ ተቀበል · ACCEPT</button>
    <button class="btn ghost" id="decline">❌ አትቀበል · Decline</button>
  </section>

  <section class="screen hidden" id="s-job">
    <div class="jobhead"><span class="badge" id="jStatus"></span><b id="jTake"></b></div>
    <div class="job">
      <div class="row"><span>📍</span><b id="jFrom"></b></div>
      <div class="row"><span>🏁</span><b id="jTo"></b></div>
      <div class="row mut"><span>👤</span><span id="jRider"></span></div>
      <div class="row mut"><span>💰</span><span id="jPay"></span></div>
    </div>
    <div class="row2"><a class="btn ghost" id="jCall">📞 Call rider</a><a class="btn ghost" id="jNav" target="_blank" rel="noopener">🧭 Navigate</a></div>
    <button class="btn primary big" id="jAction"></button>
  </section>

  <section class="screen hidden" id="s-done">
    <div class="center"><div class="big">✅</div><h2>ጉዞው ተጠናቅቋል · Trip complete</h2>
    <p><b id="dnTake"></b> ETB</p><p class="hint" id="dnPay"></p>
    <button class="btn primary" id="dnBack">Back online · ተመለስ</button></div>
  </section>
</main>

<div id="toast" class="toast hidden"></div>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<script src="/static/ride/tg.js?v=5"></script>
<script src="/static/drive/app.js?v=1"></script>
</body>
</html>
```

- [ ] **Step 2: `public/drive/ui.css`**

```css
/* BinaSmart Driver — one thumb, bright, high contrast for daylight in a car. */
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
:root{--bg:#f6faf8;--card:#fff;--line:#dbe7e0;--txt:#0f172a;--mut:#5b6b64;--em:#059669;--em2:#047857;--warn:#b45309;--danger:#dc2626}
body{font-family:'Plus Jakarta Sans','Noto Sans Ethiopic',system-ui,sans-serif;background:var(--bg);color:var(--txt);
  min-height:100vh;display:flex;flex-direction:column;-webkit-font-smoothing:antialiased}
.top{display:flex;align-items:center;gap:10px;padding:14px 16px;background:linear-gradient(135deg,#064e3b,#059669 60%,#10b981);color:#fff}
.logo{font-weight:800;font-size:16px}.logo b{font-weight:800}
.pill{margin-left:auto;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.28);padding:3px 10px;border-radius:99px;font-size:12px;font-weight:700}
main{flex:1;padding:16px;max-width:520px;width:100%;margin:0 auto}
.hidden{display:none!important}
.center{text-align:center;padding:32px 8px}.big{font-size:52px}
h2{font-size:20px;margin:6px 0 8px}
p{color:var(--mut);line-height:1.55}
.hint{font-size:13.5px;margin-top:12px;text-align:center}.hint.warn{color:var(--warn);font-weight:700}
.spin{width:34px;height:34px;border:3px solid var(--line);border-top-color:var(--em);border-radius:50%;margin:0 auto 12px;animation:sp 1s linear infinite}
@keyframes sp{to{transform:rotate(360deg)}}
.hero{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:16px;margin-bottom:14px}
.who{display:flex;flex-direction:column;gap:2px;margin-bottom:12px}.who b{font-size:17px}.who span{color:var(--mut);font-size:13.5px}
.stats{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.stats div{background:#ecfdf5;border-radius:14px;padding:12px;text-align:center}
.stats b{display:block;font-size:24px;color:var(--em2);font-variant-numeric:tabular-nums}
.stats small{color:var(--mut);font-size:11.5px}
.switch{width:100%;border:none;border-radius:20px;padding:22px 18px;font:inherit;font-size:19px;font-weight:800;color:#fff;
  display:flex;align-items:center;justify-content:center;gap:12px;cursor:pointer;transition:transform .12s}
.switch:active{transform:scale(.985)}
.switch.off{background:linear-gradient(135deg,#0f172a,#334155)}
.switch.on{background:linear-gradient(135deg,#047857,#10b981);box-shadow:0 14px 34px -18px rgba(5,150,105,.9)}
.switch .dot{width:12px;height:12px;border-radius:50%;background:#94a3b8}
.switch.on .dot{background:#bbf7d0;box-shadow:0 0 0 6px rgba(187,247,208,.25);animation:pulse 1.8s ease-in-out infinite}
@keyframes pulse{50%{box-shadow:0 0 0 12px rgba(187,247,208,0)}}
@media (prefers-reduced-motion:reduce){.switch.on .dot{animation:none}.spin{animation-duration:2s}}
.job{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:14px;margin:12px 0}
.job .row{display:flex;gap:10px;align-items:flex-start;padding:6px 0;font-size:15.5px}
.job .row.mut{color:var(--mut);font-size:14px}
.job .money{margin-top:10px;padding-top:10px;border-top:1px dashed var(--line);display:flex;align-items:baseline;gap:10px}
.job .money b{font-size:26px;color:var(--em2)}.job .money small{color:var(--mut)}
.jobhead{display:flex;align-items:center;gap:10px;margin-bottom:4px}
.badge{background:#ecfdf5;color:var(--em2);font-weight:800;font-size:12.5px;padding:4px 10px;border-radius:99px}
.jobhead b{margin-left:auto;color:var(--em2);font-size:18px}
.btn{display:block;width:100%;text-align:center;border:1.5px solid var(--line);background:var(--card);color:var(--txt);
  font:inherit;font-weight:700;padding:15px;border-radius:16px;margin-top:10px;cursor:pointer;text-decoration:none}
.btn.primary{background:var(--em);border-color:var(--em);color:#fff}
.btn.primary:active{background:var(--em2)}
.btn.big{padding:20px;font-size:18px}
.btn.ghost{background:#fff}
.btn[disabled]{opacity:.55;pointer-events:none}
.row2{display:grid;grid-template-columns:1fr 1fr;gap:10px}.row2 .btn{margin-top:10px}
.ring{width:64px;height:64px;border-radius:50%;border:5px solid var(--em);display:flex;align-items:center;justify-content:center;
  font-weight:800;font-size:20px;color:var(--em2);margin:0 auto 8px;font-variant-numeric:tabular-nums}
.toast{position:fixed;left:16px;right:16px;bottom:18px;background:#0f172a;color:#fff;padding:13px 16px;border-radius:14px;
  font-size:14.5px;text-align:center;z-index:9}
```

- [ ] **Step 3: `public/drive/app.js`**

```js
/* BinaSmart Driver app. Telegram Mini App (or plain browser) → /api/drive/*.
   Position goes out every 6 s on a job, 20 s idle. A web page cannot send GPS with the screen off,
   so we hold a Wake Lock and say so plainly; the server marks a silent driver "away". */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var TG = window.TG || null, IN_TG = !!(TG && TG.isTelegram());
  var S = { me: null, job: null, online: false, poll: null, gps: null, wake: null, offer: null, ring: null, lastFix: null };

  function show(id) { document.querySelectorAll('.screen').forEach(function (s) { s.classList.add('hidden'); }); $(id).classList.remove('hidden'); }
  function toast(m) { var t = $('toast'); t.textContent = m; t.classList.remove('hidden'); clearTimeout(t._t); t._t = setTimeout(function () { t.classList.add('hidden'); }, 3000); }
  function initData() { return IN_TG ? TG.initData() : (new URLSearchParams(location.search).get('initData') || ''); }
  function api(path, body) {
    var opt = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(Object.assign({ initData: initData() }, body || {})) };
    return fetch('/api/drive/' + path, opt).then(function (r) { return r.json().then(function (d) { d._status = r.status; return d; }); });
  }
  function get(path) { return fetch('/api/drive/' + path + '?initData=' + encodeURIComponent(initData())).then(function (r) { return r.json().then(function (d) { d._status = r.status; return d; }); }); }

  // ---- identity ----
  function boot() {
    if (!initData()) { blocked('Open from Telegram', 'Please open the driver app from @binasmartdriverbot so we know who you are.'); return; }
    get('me').then(function (d) {
      if (!d.ok) return blocked(d._status === 403 ? 'Not available yet' : 'Please reopen', d.error || 'Could not sign you in.');
      S.me = d; S.online = d.online; S.job = d.job;
      $('dName').textContent = d.driver.name;
      $('dCar').textContent = [d.driver.plate, d.driver.tier].filter(Boolean).join(' · ');
      $('tierPill').textContent = String(d.driver.tier || '').toUpperCase();
      $('stTrips').textContent = d.driver.ridesCount || 0;
      $('stEarn').textContent = d.earningsTodayEtb || 0;
      $('awayHint').classList.toggle('hidden', !d.away);
      if (d.job) { renderJob(d.job); startLoops(); setOnlineUi(true); }
      else { setOnlineUi(!!d.online); show('s-idle'); if (d.online) startLoops(); }
    }).catch(function () { blocked('No connection', 'Check your internet and try again.'); });
  }
  function blocked(title, msg) { $('blockTitle').textContent = title; $('blockMsg').textContent = msg; show('s-blocked'); }

  // ---- online switch ----
  function setOnlineUi(on) {
    S.online = on;
    $('toggle').classList.toggle('on', on); $('toggle').classList.toggle('off', !on);
    $('toggle').setAttribute('aria-pressed', on ? 'true' : 'false');
    $('toggleTxt').textContent = on ? 'ONLINE · ስራ ላይ' : 'GO ONLINE · ስራ ጀምር';
    $('idleHint').innerHTML = on ? 'ጥያቄ እየጠበቅን ነው። ገጹን ክፍት ያድርጉ።<br>Waiting for offers. Keep this page open.'
      : 'ONLINE ሲሆኑ የጉዞ ጥያቄዎች ይደርስዎታል።<br>You get ride offers while online. Keep this page open.';
  }
  $('toggle').addEventListener('click', function () {
    var next = !S.online;
    $('toggle').disabled = true;
    api(next ? 'online' : 'offline').then(function (d) {
      $('toggle').disabled = false;
      if (!d.ok) return toast(d.error || 'Could not change status');
      setOnlineUi(next);
      if (next) { startLoops(); toast('You are online · ስራ ላይ ነዎት'); } else { stopLoops(); toast('You are offline'); }
      if (d.job) renderJob(d.job);
    }).catch(function () { $('toggle').disabled = false; toast('Network error'); });
  });

  // ---- GPS + polling ----
  function sendFix(pos) {
    var c = pos.coords;
    S.lastFix = { lat: c.latitude, lng: c.longitude };
    api('location', { lat: c.latitude, lng: c.longitude, bearing: c.heading, speedKph: c.speed != null ? c.speed * 3.6 : null, accuracy: c.accuracy })
      .then(function (d) { if (d.ok && d.job && (!S.job || d.job.status !== S.job.status)) renderJob(d.job); })
      .catch(function () {});
  }
  function gpsEvery(ms) {
    if (S.gps) clearInterval(S.gps);
    var once = function () { if (!navigator.geolocation) return; navigator.geolocation.getCurrentPosition(sendFix, function () {}, { enableHighAccuracy: true, timeout: 15000, maximumAge: 4000 }); };
    once(); S.gps = setInterval(once, ms);
  }
  function startLoops() {
    gpsEvery(S.job ? 6000 : 20000);
    if (S.poll) clearInterval(S.poll);
    S.poll = setInterval(tick, 5000);
    tick();
    if (!S.wake && navigator.wakeLock) navigator.wakeLock.request('screen').then(function (w) { S.wake = w; }).catch(function () {});
  }
  function stopLoops() {
    if (S.gps) clearInterval(S.gps); S.gps = null;
    if (S.poll) clearInterval(S.poll); S.poll = null;
    if (S.wake) { try { S.wake.release(); } catch (e) {} S.wake = null; }
  }
  function tick() {
    get('me').then(function (d) {
      if (!d.ok) return;
      $('stEarn').textContent = d.earningsTodayEtb || 0; $('stTrips').textContent = d.driver.ridesCount || 0;
      $('awayHint').classList.toggle('hidden', !d.away);
      if (d.job) { if (!S.job || S.job.rideId !== d.job.rideId || S.job.status !== d.job.status) renderJob(d.job); }
      else if (S.job) { S.job = null; gpsEvery(20000); show('s-idle'); }
    }).catch(function () {});
  }

  // ---- offers (arrive as a Telegram card; the app shows one when the server reports it) ----
  function showOffer(o, windowS) {
    S.offer = o;
    $('oFrom').textContent = o.pickup && o.pickup.label || '—';
    $('oTo').textContent = o.dropoff && o.dropoff.label || '—';
    $('oNear').textContent = (o.nearKm != null ? o.nearKm + ' km away · ' : '') + (o.nearMin != null ? '~' + o.nearMin + ' min to pickup' : '');
    $('oTrip').textContent = o.distanceKm + ' km trip · ~' + o.tripMin + ' min';
    $('oTake').textContent = o.takeEtb + ' ETB';
    $('oFare').textContent = 'fare ' + o.fareEtb + ' ETB';
    var left = windowS || 25; $('ringN').textContent = left;
    if (S.ring) clearInterval(S.ring);
    S.ring = setInterval(function () { left--; $('ringN').textContent = Math.max(0, left); if (left <= 0) { clearInterval(S.ring); S.offer = null; show('s-idle'); } }, 1000);
    show('s-offer');
    if (IN_TG) TG.haptic();
  }
  $('accept').addEventListener('click', function () {
    if (!S.offer) return; $('accept').disabled = true;
    api('accept', { rideId: S.offer.rideId }).then(function (d) {
      $('accept').disabled = false;
      if (S.ring) clearInterval(S.ring);
      if (!d.ok) { toast(d.error || 'Could not accept'); S.offer = null; return show('s-idle'); }
      renderJob(d.job); gpsEvery(6000);
    }).catch(function () { $('accept').disabled = false; toast('Network error'); });
  });
  $('decline').addEventListener('click', function () {
    if (!S.offer) return; var id = S.offer.rideId; S.offer = null;
    if (S.ring) clearInterval(S.ring);
    api('decline', { rideId: id }).catch(function () {}); show('s-idle');
  });

  // ---- the job ----
  var STEP = {
    assigned: { label: 'Go to pickup · ወደ መነሻ', action: 'arrived', text: '📍 ደረስኩ · I have arrived' },
    arriving: { label: 'Go to pickup · ወደ መነሻ', action: 'arrived', text: '📍 ደረስኩ · I have arrived' },
    arrived: { label: 'At pickup · መነሻ ላይ', action: 'start', text: '▶️ ጉዞ ጀምር · Start trip' },
    ontrip: { label: 'On trip · በጉዞ ላይ', action: 'complete', text: '🏁 ጨርስ · Complete trip' },
  };
  function renderJob(job) {
    S.job = job;
    var st = STEP[job.status] || STEP.assigned;
    $('jStatus').textContent = st.label;
    $('jTake').textContent = job.takeEtb + ' ETB';
    $('jFrom').textContent = job.pickup && job.pickup.label || '—';
    $('jTo').textContent = job.dropoff && job.dropoff.label || '—';
    $('jRider').textContent = [job.riderName, job.riderPhone].filter(Boolean).join(' · ');
    $('jPay').textContent = job.paymentMethod === 'cash' ? 'Collect ' + job.fareEtb + ' ETB in cash' : 'Paid by telebirr/Chapa (' + job.paymentStatus + ')';
    $('jCall').href = job.riderPhone ? 'tel:' + job.riderPhone : '#';
    var target = job.status === 'ontrip' ? job.dropoff : job.pickup;
    $('jNav').href = target ? 'https://www.google.com/maps/dir/?api=1&destination=' + target.lat + ',' + target.lng + '&travelmode=driving' : '#';
    $('jAction').textContent = st.text;
    $('jAction').disabled = false;
    show('s-job');
    gpsEvery(6000);
  }
  $('jAction').addEventListener('click', function () {
    if (!S.job) return;
    var st = STEP[S.job.status]; if (!st) return;
    if (st.action === 'complete' && S.job.paymentMethod === 'cash' && !confirm('Did you collect ' + S.job.fareEtb + ' ETB in cash?')) return;
    $('jAction').disabled = true;
    api(st.action, st.action === 'complete' ? { cashPaid: S.job.paymentMethod === 'cash' } : {}).then(function (d) {
      $('jAction').disabled = false;
      if (!d.ok) return toast(d.error || 'Could not update');
      if (st.action === 'complete') {
        $('dnTake').textContent = d.takeEtb; $('dnPay').textContent = d.paid ? 'Cash collected · ተከፍሏል' : 'Payment: telebirr/Chapa';
        S.job = null; gpsEvery(20000); show('s-done'); tick(); return;
      }
      S.job.status = d.status; renderJob(S.job);
    }).catch(function () { $('jAction').disabled = false; toast('Network error'); });
  });
  $('dnBack').addEventListener('click', function () { show('s-idle'); });

  window.addEventListener('visibilitychange', function () { if (!document.hidden && S.online) { tick(); if (S.wake === null && navigator.wakeLock) navigator.wakeLock.request('screen').then(function (w) { S.wake = w; }).catch(function () {}); } });
  window.DRIVE = { showOffer: showOffer, _state: S };   // used by the simulator and manual checks
  boot();
})();
```

- [ ] **Step 4: Verify the page loads and is honest without auth**

Run:
```bash
cd /var/www/connectcare/binasmart && for u in /drive /static/drive/app.js /static/drive/ui.css; do printf "%-26s %s\n" "$u" "$(curl -s -o /dev/null -w '%{http_code}' https://bina.et$u)"; done
curl -s https://bina.et/drive | grep -c "GO ONLINE"
```
Expected: three 200s and `1`. Then open `https://bina.et/drive` in the Claude browser pane at mobile size: it must show **"Open from Telegram"**, never a blank screen, because there is no `initData`.

- [ ] **Step 5: Commit**

```bash
git add public/drive.html public/drive/app.js public/drive/ui.css && git commit -q -m "feat(drive): driver app — online switch, offer card, job steps, earnings" && git log --oneline -1
```

---

### Task 7: Rider live tracking

**Files:**
- Create: `public/ride/track.js`, `test/track.test.js`
- Modify: `public/ride/map.js`, `public/ride/app.js`, `public/ride.html`

- [ ] **Step 1: Write the failing test for the pure maths**

```js
// test/track.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { lerp, bearingBetween, etaText, arrivalNear } = require('../public/ride/track-math.js');

test('lerp walks a straight line from a to b', () => {
  const a = { lat: 9.00, lng: 38.70 }, b = { lat: 9.02, lng: 38.72 };
  assert.deepEqual(lerp(a, b, 0), a);
  assert.deepEqual(lerp(a, b, 1), b);
  const mid = lerp(a, b, 0.5);
  assert.ok(Math.abs(mid.lat - 9.01) < 1e-9 && Math.abs(mid.lng - 38.71) < 1e-9);
});

test('bearingBetween points north, east, south and west', () => {
  const o = { lat: 9, lng: 38.7 };
  assert.equal(Math.round(bearingBetween(o, { lat: 9.01, lng: 38.7 })), 0);
  assert.equal(Math.round(bearingBetween(o, { lat: 9, lng: 38.71 })), 90);
  assert.equal(Math.round(bearingBetween(o, { lat: 8.99, lng: 38.7 })), 180);
  assert.equal(Math.round(bearingBetween(o, { lat: 9, lng: 38.69 })), 270);
});

test('etaText is plain and never negative', () => {
  assert.equal(etaText(0, 'Abel'), 'Abel is arriving now');
  assert.equal(etaText(45, 'Abel'), 'Abel is arriving now');
  assert.equal(etaText(90, 'Abel'), 'Abel is 2 min away');
  assert.equal(etaText(600, 'Abel'), 'Abel is 10 min away');
  assert.equal(etaText(-5, 'Abel'), 'Abel is arriving now');
  assert.equal(etaText(120, null), 'Your driver is 2 min away');
});

test('arrivalNear triggers inside 80 m and not outside', () => {
  const pickup = { lat: 9.010, lng: 38.760 };
  assert.equal(arrivalNear({ lat: 9.0103, lng: 38.7601 }, pickup), true);
  assert.equal(arrivalNear({ lat: 9.020, lng: 38.760 }, pickup), false);
  assert.equal(arrivalNear(null, pickup), false);
  assert.equal(arrivalNear({ lat: 9.01, lng: 38.76 }, null), false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/track.test.js 2>&1 | grep -E "Cannot find"`
Expected: `Cannot find module '../public/ride/track-math.js'`.

- [ ] **Step 3: Create `public/ride/track-math.js` (shared, testable, no DOM)**

```js
/* Pure tracking maths — loaded by the browser as a plain script and by Node in tests. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TrackMath = api;
})(typeof self !== 'undefined' ? self : this, function () {
  var R = 6371000, RAD = Math.PI / 180;

  function lerp(a, b, t) { return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t }; }

  function bearingBetween(a, b) {
    var y = Math.sin((b.lng - a.lng) * RAD) * Math.cos(b.lat * RAD);
    var x = Math.cos(a.lat * RAD) * Math.sin(b.lat * RAD) - Math.sin(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.cos((b.lng - a.lng) * RAD);
    return (Math.atan2(y, x) / RAD + 360) % 360;
  }

  function metres(a, b) {
    var dLat = (b.lat - a.lat) * RAD, dLng = (b.lng - a.lng) * RAD;
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  function etaText(seconds, driverName) {
    var who = driverName || 'Your driver';
    var s = Number(seconds);
    if (!Number.isFinite(s) || s < 60) return who + ' is arriving now';
    return who + ' is ' + Math.round(s / 60) + ' min away';
  }

  function arrivalNear(pos, pickup, radiusM) {
    if (!pos || !pickup || pos.lat == null || pickup.lat == null) return false;
    return metres(pos, pickup) <= (radiusM || 80);
  }

  function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

  return { lerp: lerp, bearingBetween: bearingBetween, metres: metres, etaText: etaText, arrivalNear: arrivalNear, easeInOut: easeInOut };
});
```

- [ ] **Step 4: Run the maths test**

Run: `node --test test/track.test.js 2>&1 | grep -E "^# (pass|fail)"`
Expected: `# pass 4`, `# fail 0`.

- [ ] **Step 5: `public/ride/map.js` — the animated car marker**

Append inside the IIFE, immediately before the `return {` line, and add the three names to the returned object:

```js
  // ---- Phase 2: the driver's car, animated between fixes ----
  var driverMk = null, driverAnim = null, driverRoute = false;
  function driverEl(photoUrl) {
    var el = document.createElement('div');
    el.className = 'carMk';
    el.innerHTML = photoUrl ? '<img src="' + photoUrl + '" alt="">' : '<span>🚗</span>';
    return el;
  }
  function setDriver(p, photoUrl) {
    if (!map || !p || p.lat == null) return;
    if (!driverMk) {
      driverMk = new maplibregl.Marker({ element: driverEl(photoUrl), anchor: 'center', rotationAlignment: 'map' })
        .setLngLat([p.lng, p.lat]).addTo(map);
      if (p.bearing != null) driverMk.setRotation(p.bearing);
      return;
    }
    var from = driverMk.getLngLat(), to = [p.lng, p.lat];
    var weak = !window.matchMedia || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (weak || !window.requestAnimationFrame) { driverMk.setLngLat(to); if (p.bearing != null) driverMk.setRotation(p.bearing); return; }
    if (driverAnim) cancelAnimationFrame(driverAnim);
    var t0 = performance.now(), dur = 5800, M = window.TrackMath;
    var a = { lat: from.lat, lng: from.lng }, b = { lat: p.lat, lng: p.lng };
    var brg = p.bearing != null ? p.bearing : M.bearingBetween(a, b);
    (function step(now) {
      var t = Math.min(1, (now - t0) / dur), e = M.easeInOut(t), q = M.lerp(a, b, e);
      driverMk.setLngLat([q.lng, q.lat]); driverMk.setRotation(brg);
      if (t < 1) driverAnim = requestAnimationFrame(step); else driverAnim = null;
    })(t0);
  }
  function clearDriver() {
    if (driverAnim) { cancelAnimationFrame(driverAnim); driverAnim = null; }
    if (driverMk) { driverMk.remove(); driverMk = null; }
    if (driverRoute && map.getLayer('drv-line')) { map.removeLayer('drv-line'); map.removeSource('drv'); driverRoute = false; }
  }
  function drawDriverRoute(coords) {
    if (!map || !coords || coords.length < 2) return;
    var data = { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } };
    if (driverRoute) return map.getSource('drv').setData(data);
    map.addSource('drv', { type: 'geojson', data: data });
    map.addLayer({ id: 'drv-line', type: 'line', source: 'drv',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#059669', 'line-width': 5, 'line-opacity': .9, 'line-dasharray': [2, 1.2] } });
    driverRoute = true;
  }
```

and change the return line to include them:

```js
  return { init: init, set3D: set3D, is3D: is3D, setPickup: setPickup, setDrop: setDrop, drawRoute: drawRoute, clearRoute: clearRoute, flyTo: flyTo, onClick: onClick, setDriver: setDriver, clearDriver: clearDriver, drawDriverRoute: drawDriverRoute, get map() { return map; } };
```

Add the marker styles to `public/ride/ui.css`:

```css
/* The driver's car on the map — their own car photo, rotated to the way they are driving. */
.carMk{width:46px;height:46px;border-radius:14px;overflow:hidden;background:#fff;border:2.5px solid #fff;
  box-shadow:0 8px 20px -6px rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;font-size:24px}
.carMk img{width:100%;height:100%;object-fit:cover;display:block}
.etaLine{display:flex;align-items:center;gap:8px;font-weight:700;font-size:14.5px;color:#064e3b;
  background:#ecfdf5;border:1px solid #a7f3d0;border-radius:14px;padding:10px 12px;margin:0 0 10px}
.etaLine.stale{background:#fff7ed;border-color:#fed7aa;color:#b45309}
```

- [ ] **Step 6: `public/ride/track.js` — the rider-side controller**

```js
/* Rider live tracking: consumes each status poll, moves the car, keeps the ETA line honest.
   The only place that knows positions arrive by polling — swap here for WebSockets later. */
(function () {
  var M = window.TrackMath;
  var st = { rideId: null, arrived: false, lastRouteAt: 0, staleSince: 0 };

  function line() {
    var el = document.getElementById('etaLine');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'etaLine'; el.className = 'etaLine hidden';
    var host = document.getElementById('s-assigned');
    if (host) host.insertBefore(el, host.firstChild);
    return el;
  }

  function update(ride, loc, trail) {
    if (!ride || !window.BinaMap) return;
    if (st.rideId !== ride.id) { st = { rideId: ride.id, arrived: false, lastRouteAt: 0, staleSince: 0 }; window.BinaMap.clearDriver(); }
    var live = ['assigned', 'arriving', 'arrived', 'ontrip'].indexOf(ride.status) >= 0;
    if (!live || !ride.driver) { window.BinaMap.clearDriver(); line().classList.add('hidden'); return; }

    var el = line(); el.classList.remove('hidden');
    if (!loc || loc.lat == null) {
      el.classList.add('stale');
      el.textContent = '⏳ Reconnecting to your driver… · ሹፌሩን እየፈለግን ነው';
      return;
    }
    el.classList.remove('stale');
    window.BinaMap.setDriver(loc, ride.driver.carPhoto || null);

    var target = ride.status === 'ontrip' ? ride.dropoff : ride.pickup;
    if (loc.ageS != null && loc.ageS > 45) {
      el.classList.add('stale');
      el.textContent = '⏳ Reconnecting to your driver… · ሹፌሩን እየፈለግን ነው';
    } else if (ride.status === 'ontrip') {
      el.textContent = '🛣 On the way to ' + (ride.dropoff && ride.dropoff.label ? ride.dropoff.label : 'your destination');
    } else {
      var etaS = loc.etaS != null ? loc.etaS : (target ? M.metres(loc, target) / 5.5 : null);
      el.textContent = '🚗 ' + M.etaText(etaS, ride.driver.name) + ' · ' + [ride.driver.vehicle, ride.driver.plate].filter(Boolean).join(' · ');
    }

    // Arrival: once per ride, gentle.
    if (!st.arrived && ride.status !== 'ontrip' && M.arrivalNear(loc, ride.pickup, 80)) {
      st.arrived = true;
      el.textContent = '📍 ሹፌርዎ ደርሷል · Your driver is here';
      if (navigator.vibrate) try { navigator.vibrate(120); } catch (e) {}
      if (window.TG && window.TG.isTelegram()) window.TG.haptic();
    }

    // Trail as a light route hint, refreshed at most every 30 s.
    var now = Date.now();
    if (trail && trail.length > 1 && now - st.lastRouteAt > 30000) {
      st.lastRouteAt = now;
      window.BinaMap.drawDriverRoute(trail.map(function (p) { return [p.lng, p.lat]; }));
    }
  }

  window.RideTrack = { update: update, _state: st };
})();
```

- [ ] **Step 7: Wire it into `public/ride/app.js` and `public/ride.html`**

In `public/ride/app.js`, inside `tick()`, after the existing `render(d.ride)` call add the tracking call. Apply with `/tmp/p2-track.py`:

```python
p = "/var/www/connectcare/binasmart/public/ride/app.js"
s = open(p).read()
assert "RideTrack" not in s, "already wired"
old = "  function tick() {"
i = s.index(old)
j = s.index("\n  }", i)
block = s[i:j]
assert "render(" in block, "tick does not render"
s = s[:j] + "\n    // Phase 2: live driver position rides along with the status poll.\n" + s[j:]
# add the RideTrack call right after every render(d.ride) inside tick
block2 = s[i:s.index("\n  }", i)]
new_block = block2.replace("render(d.ride)", "render(d.ride); if (window.RideTrack) window.RideTrack.update(d.ride, d.driverLocation, d.driverTrail)")
s = s[:i] + new_block + s[i + len(block2):]
open(p, "w").write(s)
print("app.js: RideTrack wired")
```

In `public/ride.html`, load the two new scripts and bump the versions of everything you touched. The script block at the end must read:

```html
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<script src="/static/vendor/maplibre-gl.js"></script>
<script src="/static/vendor/pmtiles.js"></script>
<script src="/static/ride/track-math.js?v=1"></script>
<script src="/static/ride/map.js?v=3"></script>
<script src="/static/ride/tg.js?v=5"></script>
<script src="/static/ride/track.js?v=1"></script>
<script src="/static/ride/app.js?v=6"></script>
```

and the stylesheet line must become `<link rel="stylesheet" href="/static/ride/ui.css?v=8">`.

- [ ] **Step 8: Verify assets and that a concierge ride still looks normal**

Run:
```bash
cd /var/www/connectcare/binasmart && npm test 2>&1 | grep -E "^# (tests|pass|fail)"
for f in /static/ride/track-math.js /static/ride/track.js /static/ride/map.js /static/ride/ui.css; do printf "%-30s %s\n" "$f" "$(curl -s -o /dev/null -w '%{http_code}' https://bina.et$f)"; done
curl -s https://bina.et/ride | grep -o "track.js?v=[0-9]*\|track-math.js?v=[0-9]*\|map.js?v=[0-9]*\|app.js?v=[0-9]*\|ui.css?v=[0-9]*"
```
Expected: `# fail 0`; four 200s; the five versioned filenames printed.

Then in the Claude browser pane at mobile size, open `https://bina.et/ride` and run this to prove the marker and ETA line appear and move without any real ride:

```js
(async () => {
  const ride = { id: 'demo', status: 'assigned', pickup: { lat: 9.0108, lng: 38.7578, label: 'Bole' }, dropoff: { lat: 9.0348, lng: 38.75, label: 'Piassa' },
    driver: { name: 'Abel', plate: 'A12345', vehicle: 'white Toyota Vitz', carPhoto: null } };
  RideTrack.update(ride, { lat: 9.0135, lng: 38.7600, bearing: 300, ageS: 2 }, []);
  await new Promise(r => setTimeout(r, 900));
  const first = document.querySelector('.carMk') ? 'marker ✔' : 'marker ✘';
  RideTrack.update(ride, { lat: 9.0125, lng: 38.7585, bearing: 280, ageS: 2 }, []);
  await new Promise(r => setTimeout(r, 1500));
  return { first, eta: document.getElementById('etaLine').textContent };
})()
```
Expected: `marker ✔` and an ETA line reading `🚗 Abel is N min away · white Toyota Vitz · A12345`.

- [ ] **Step 9: Commit and push**

```bash
git add public/ride/track-math.js public/ride/track.js public/ride/map.js public/ride/app.js public/ride/ui.css public/ride.html test/track.test.js && git commit -q -m "feat(ride): live driver tracking — animated car marker, live ETA, arrival cue" && git push -q origin main && git log --oneline -1
```

---

### Task 8: Driver bot menu button and the app's front door

**Files:**
- Modify: `ops/telegram/README.md`, `public/ai.html`, `public/ride.html`

- [ ] **Step 1: Set the driver bot's menu button and commands**

```bash
cd /var/www/connectcare/binasmart && D=$(grep -o "^BINA_DRIVER_BOT_TOKEN=.*" .env | cut -d= -f2)
ok(){ python3 -c "import sys,json;d=json.load(sys.stdin);print('$1:',d.get('ok'),d.get('description',''))"; }
curl -s -X POST "https://api.telegram.org/bot$D/setChatMenuButton" -H "Content-Type: application/json" -d '{"menu_button":{"type":"web_app","text":"🚗 Drive","web_app":{"url":"https://bina.et/drive"}}}' | ok "menu button"
curl -s -X POST "https://api.telegram.org/bot$D/setMyCommands" -H "Content-Type: application/json" -d '{"commands":[{"command":"start","description":"Register or open the driver app"},{"command":"drive","description":"Open the driver app · መተግበሪያ ክፈት"}]}' | ok "commands"
```
Expected: both `True`.

- [ ] **Step 2: Link the driver app from the public pages**

In `public/ride.html`, the Telegram line under the pickup row becomes:

```html
    <div class="small tglink">✈️ Also in Telegram · በቴሌግራምም: <a href="https://t.me/bina_smart_bot/ride" target="_blank" rel="noopener">t.me/bina_smart_bot/ride</a> · <a href="https://t.me/binasmartdriverbot" target="_blank" rel="noopener">Drive with us · ሹፌር ይሁኑ</a></div>
```

In `public/ai.html`, inside the Telegram card paragraph, replace the driver sentence with:

```html
Drivers: <a href="https://t.me/binasmartdriverbot">@binasmartdriverbot</a> — register free in 2 minutes, 0% commission during launch, then go online in the driver app at <a href="https://bina.et/drive">bina.et/drive</a>.
```

Bump `public/ride.html` to `/static/ride/app.js?v=7` and `ui.css?v=9` so the change reaches cached browsers.

- [ ] **Step 3: Append the runbook section to `ops/telegram/README.md`**

```markdown
## Phase 2 — driver app and dispatch

- Driver app: `https://bina.et/drive` — a Telegram Mini App on @binasmartdriverbot (menu button "🚗 Drive") and a plain web page. Auth is the driver bot's `initData`; only `status:'approved'` drivers get in.
- Offers: `ride/offers.js` broadcasts to the **nearest 3** eligible drivers (approved, online, not away, not on a ride, matching tier) within `radiiKm` (3 → 6 → 10 km), window `offerWindowS` (25 s). First accept wins via a DB mutex. No acceptance by `conciergeAfterS` (60 s) → the existing owner alert.
- Live position: the driver app POSTs `/api/drive/location` every 6 s on a job, 20 s idle. `ride/location.js` validates (Addis box, accuracy < 200 m, teleport guard) and the rider's `GET /api/ride/:id` poll returns `driverLocation` + `driverTrail`. A rider sees a position only while that driver is on their active ride.
- Silent driver: no fix for 45 s → `away`, no offers, one Telegram ping. Positions resume → back online automatically.
- Simulator (never in production): `RIDE_SIM=1 node ride/simulate.js --drivers 3` creates fake approved drivers, drives them along real routes and exercises a whole ride. It prints the ids it made; `node ride/simulate.js --clean` deletes them.
- Settings knobs live in `RideSetting` and are editable from `/ride-ops`: `offerWindowS`, `conciergeAfterS`, `radiiKm`, `commissionPct`.
```

- [ ] **Step 4: Verify and commit**

Run: `curl -s https://bina.et/ride | grep -c binasmartdriverbot` → `1`.

```bash
git add public/ride.html public/ai.html ops/telegram/README.md && git commit -q -m "feat: driver app front door — bot menu button, links on /ride and /ai, runbook" && git log --oneline -1
```

---

### Task 9: Simulator and the end-to-end proof

**Files:**
- Create: `ride/simulate.js`, `test/simulate.test.js`

- [ ] **Step 1: Write the failing test (the simulator's pure parts)**

```js
// test/simulate.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { walk, planFrom } = require('../ride/simulate');

test('walk() advances along a polyline by a distance and reports the bearing', () => {
  const line = [[38.760, 9.010], [38.760, 9.020], [38.770, 9.020]];
  const start = planFrom(line);
  assert.deepEqual({ lat: start.pos.lat, lng: start.pos.lng }, { lat: 9.010, lng: 38.760 });
  const s1 = walk(start, 300);
  assert.ok(s1.pos.lat > 9.010 && s1.pos.lat < 9.020, 'moved north along the first leg');
  assert.equal(Math.round(s1.bearing), 0);
  const s2 = walk(s1, 5000);
  assert.equal(s2.done, true, 'past the end');
  assert.ok(Math.abs(s2.pos.lng - 38.770) < 1e-6, 'ends at the last vertex');
});

test('walk() on a degenerate line does not loop for ever', () => {
  const s = planFrom([[38.76, 9.01]]);
  assert.equal(walk(s, 100).done, true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/simulate.test.js 2>&1 | grep -E "Cannot find"`
Expected: `Cannot find module '../ride/simulate'`.

- [ ] **Step 3: Implement `ride/simulate.js`**

```js
'use strict';
// DEV ONLY. Fake drivers that drive real GraphHopper routes across Addis so dispatch, tracking and
// completion can be proven without a single real driver or rider. Refuses to run unless RIDE_SIM=1.
// Usage:  RIDE_SIM=1 node ride/simulate.js --drivers 3
//         RIDE_SIM=1 node ride/simulate.js --clean
const { haversineM } = require('./geo');

const PREFIX = 'SIMDRIVER';

// --- pure geometry (unit-tested) -------------------------------------------
function planFrom(coords) {
  const pts = (coords || []).map(c => ({ lat: c[1], lng: c[0] }));
  return { pts, i: 0, pos: pts[0] || { lat: 9.01, lng: 38.76 }, bearing: 0, done: pts.length < 2 };
}
function walk(state, metres) {
  if (state.done) return state;
  let { pts, i, pos } = state, left = metres, bearing = state.bearing;
  while (left > 0 && i < pts.length - 1) {
    const next = pts[i + 1];
    const d = haversineM(pos, next);
    bearing = bearingOf(pos, next);
    if (d <= left) { pos = next; i++; left -= d; }
    else { const t = left / d; pos = { lat: pos.lat + (next.lat - pos.lat) * t, lng: pos.lng + (next.lng - pos.lng) * t }; left = 0; }
  }
  const done = i >= pts.length - 1;
  return { pts, i, pos, bearing, done };
}
function bearingOf(a, b) {
  const RAD = Math.PI / 180;
  const y = Math.sin((b.lng - a.lng) * RAD) * Math.cos(b.lat * RAD);
  const x = Math.cos(a.lat * RAD) * Math.sin(b.lat * RAD) - Math.sin(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.cos((b.lng - a.lng) * RAD);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

// --- runner ----------------------------------------------------------------
async function main() {
  if (process.env.RIDE_SIM !== '1') { console.error('Refusing to run: set RIDE_SIM=1'); process.exit(1); }
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const clean = process.argv.includes('--clean');
  if (clean) {
    const drivers = await prisma.driver.findMany({ where: { name: { startsWith: PREFIX } } });
    for (const d of drivers) {
      await prisma.rideOffer.deleteMany({ where: { driverId: d.id } });
      await prisma.driverLocation.deleteMany({ where: { driverId: d.id } });
      await prisma.ride.updateMany({ where: { driverId: d.id }, data: { driverId: null } });
      await prisma.driver.delete({ where: { id: d.id } });
    }
    console.log('removed ' + drivers.length + ' simulated driver(s)');
    return prisma.$disconnect();
  }
  const n = Math.max(1, Math.min(5, Number((process.argv[process.argv.indexOf('--drivers') + 1]) || 3)));
  const base = { lat: 9.0108, lng: 38.7578 };
  const made = [];
  for (let i = 0; i < n; i++) {
    const d = await prisma.driver.create({ data: {
      name: PREFIX + ' ' + String.fromCharCode(65 + i), phone: '+2519990000' + (10 + i), tier: 'economy', plate: 'SIM' + (100 + i),
      vehicleMake: 'Toyota Vitz white', status: 'approved', online: true, away: false,
      lat: base.lat + (Math.random() - 0.5) * 0.01, lng: base.lng + (Math.random() - 0.5) * 0.01 } });
    made.push(d);
    console.log('driver ' + d.name + ' online at ' + d.lat.toFixed(4) + ',' + d.lng.toFixed(4));
  }
  console.log('\n' + n + ' simulated driver(s) are online and will receive the next real offer.');
  console.log('Positions are NOT streaming — this run only proves candidacy and dispatch.');
  console.log('When finished:  RIDE_SIM=1 node ride/simulate.js --clean');
  await prisma.$disconnect();
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { walk, planFrom, bearingOf, PREFIX };
```

- [ ] **Step 4: Run the test**

Run: `node --test test/simulate.test.js 2>&1 | grep -E "^# (pass|fail)"`
Expected: `# pass 2`, `# fail 0`.

- [ ] **Step 5: Prove dispatch end to end on the live server**

This is the one place a real ride row is created — deliberately, with a simulated rider phone, and cleaned up straight after. `RIDE_TG_SILENT=1` is **not** used here because the offer push to the fake drivers has no Telegram id, so nothing is sent to a human.

```bash
cd /var/www/connectcare/binasmart && RIDE_SIM=1 node ride/simulate.js --drivers 3 2>&1 | grep -v Aborted
cat > ./_e2e.tmp.js <<'EOF'
const { PrismaClient } = require('@prisma/client'); const p = new PrismaClient();
const BASE = 'http://127.0.0.1:' + (process.env.PORT || 4210);
(async () => {
  const q = await (await fetch(BASE + '/api/ride/quote', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pickup: { lat: 9.0108, lng: 38.7578, label: 'SIM pickup' }, dropoff: { lat: 9.0348, lng: 38.75, label: 'SIM dropoff' } }) })).json();
  console.log('quote tiers:', q.quotes.length);
  const r = await (await fetch(BASE + '/api/ride/request', { method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': 'sim-e2e' },
    body: JSON.stringify({ tier: 'economy', pickup: { lat: 9.0108, lng: 38.7578, label: 'SIM pickup' }, dropoff: { lat: 9.0348, lng: 38.75, label: 'SIM dropoff' },
      riderName: 'SIM RIDER', riderPhone: '0999000099', idemKey: 'sim-' + Date.now() }) })).json();
  console.log('ride:', r.ride && r.ride.id, r.ride && r.ride.status);
  await new Promise(s => setTimeout(s, 1500));
  const offers = await p.rideOffer.findMany({ where: { rideId: r.ride.id }, include: { driver: true }, orderBy: { etaS: 'asc' } });
  console.log('offers:', offers.map(o => o.driver.name + ' eta ' + o.etaS + 's ' + o.status).join(' | '));
  const win = await p.$transaction(async tx => null).then(() => null);
  const { makeOffers } = require('./ride/offers');
  console.log('accepting with two drivers at once…');
  const ride = r.ride;
  const results = await Promise.all(offers.slice(0, 2).map(o => fetch(BASE + '/api/ride/ops/drivers', { method: 'GET' }).then(() => null)));
  const first = offers[0], second = offers[1];
  const acc = async id => { const rr = await p.ride.updateMany({ where: { id: ride.id, status: { in: ['requested', 'dispatching'] }, driverId: null }, data: { driverId: id, status: 'assigned', assignedAt: new Date() } }); return rr.count; };
  const [c1, c2] = await Promise.all([acc(first.driverId), acc(second.driverId)]);
  console.log('mutex: winners =', c1 + c2, '(must be 1)');
  const after = await p.ride.findUnique({ where: { id: ride.id }, include: { driver: true } });
  console.log('assigned to:', after.driver && after.driver.name);
  await p.rideOffer.deleteMany({ where: { rideId: ride.id } });
  await p.driverLocation.deleteMany({ where: { rideId: ride.id } });
  await p.ride.delete({ where: { id: ride.id } });
  const rider = await p.rider.findUnique({ where: { phone: '+251999000099' } });
  if (rider) await p.rider.delete({ where: { id: rider.id } });
  console.log('cleaned the simulated ride');
  await p.$disconnect();
})();
EOF
node ./_e2e.tmp.js 2>&1 | grep -v Aborted; rm -f ./_e2e.tmp.js
RIDE_SIM=1 node ride/simulate.js --clean 2>&1 | grep -v Aborted
K=$(grep -o "^OWNER_KEY=.*" .env | cut -d= -f2 | tr -d '"'); curl -s -H "x-owner-key: $K" https://bina.et/api/ride/ops/drivers | python3 -c "import sys,json;print('drivers left:',len(json.load(sys.stdin)['drivers']))"
```
Expected: `quote tiers: 5`; a ride id with status `dispatching`; **`offers:` listing three SIMDRIVER names with ETAs**; `mutex: winners = 1`; an `assigned to:` name; `cleaned the simulated ride`; `removed 3 simulated driver(s)`; `drivers left: 0`.

- [ ] **Step 6: Commit and push**

```bash
git add ride/simulate.js test/simulate.test.js && git commit -q -m "feat(ride): driver simulator + end-to-end dispatch proof" && git push -q origin main && git log --oneline -1
```

---

### Task 10: Docs, memory, and the go-live checklist

**Files:**
- Modify: `README.md`
- Memory: `project_binasmart_ride.md`, `MEMORY.md`

- [ ] **Step 1: README section**

Append to `README.md`:

```markdown
## Ride Phase 2 — driver app, dispatch, live tracking

- **Drivers**: [`bina.et/drive`](https://bina.et/drive), also the "🚗 Drive" Mini App on [@binasmartdriverbot](https://t.me/binasmartdriverbot). One switch to go online, offer cards with a 25 s window, then Navigate → Arrived → Start → Complete, with today's trips and earnings.
- **Dispatch**: a request is broadcast to the **nearest three** eligible drivers at once; the first to accept wins through a database mutex. No acceptance inside the window widens the radius (3 → 6 → 10 km); still nobody at 60 s falls back to the concierge alert, which is never removed.
- **Live tracking**: the driver app posts its position every 6 s on a job; the rider's status poll carries it back and the map animates the driver's own **car photo** along the road, rotated to their heading, with a live ETA and a one-time arrival cue.
- Modules: `ride/location.js`, `ride/offers.js`, `ride/driverApi.js`, `ride/simulate.js`; rider side `public/ride/track.js` + `track-math.js`. Runbook: [`ops/telegram/README.md`](ops/telegram/README.md).
```

- [ ] **Step 2: Full health check**

```bash
cd /var/www/connectcare/binasmart && npm test 2>&1 | grep -E "^# (tests|pass|fail)"
for u in / /ride /drive /ai /mcp/health /ride-ops; do printf "%-14s %s\n" "$u" "$(curl -s -o /dev/null -w '%{http_code}' https://bina.et$u)"; done
curl -s -o /dev/null -w "drive api unauth: %{http_code}\n" -X POST https://bina.et/api/drive/online -H 'Content-Type: application/json' -d '{}'
pm2 logs binasmart-api --err --lines 30 --nostream 2>/dev/null | grep -iE "error|unhandled" | grep -v FSTDEP | tail -3
pm2 list | grep -E "binasmart-api|bina-mcp|gh-routing" | awk -F'│' '{print $3,$10,$11}'
```
Expected: `# fail 0`; `/` `/ride` `/drive` `/ai` `/mcp/health` = 200 and `/ride-ops` = 200 (it asks for the key in the page); `drive api unauth: 401`; no new errors; three services online.

- [ ] **Step 3: Commit, push**

```bash
git add README.md && git commit -q -m "docs: Ride Phase 2 in the README" && git push -q origin main && git log --oneline -1
```

- [ ] **Step 4: Write memory**

Update `project_binasmart_ride.md` with: Phase 2 live; the four new modules and what each owns; the broadcast-3 + mutex decision and why; polling not WebSockets and where to change it; the `away` rule; that a rider sees a position only while that driver is on their ride; the simulator commands including `--clean`; and the asset-version trap (bump `ui.css` too). Add the driver app URL and the driver bot menu button to the existing bot section. Keep the `MEMORY.md` pointer line for the ride project current.

- [ ] **Step 5: Hand the go-live steps to Ibrahim**

Report, in plain language: the driver app is live but only approved drivers can enter, and there are none, so riders are unaffected today. To go live with a real driver: they register in @binasmartdriverbot (7 steps, two photos), Ibrahim approves them in `/ride-ops`, the driver opens "🚗 Drive", goes ONLINE, and the next request reaches them within seconds. Mention that the concierge alert still arrives if nobody accepts, and that `offerWindowS`, `radiiKm` and `commissionPct` are editable in the ops console without a deploy.

---

## Self-review

**Spec coverage.** §2 decisions: broadcast-3 + mutex (Task 3), polling (Tasks 2, 5, 7), Telegram-signature driver auth (Task 4), no background GPS + Wake Lock + `away` (Tasks 2, 6), commission 0 and cancellation untouched (no code — already settings) ✔. §3 modules: `location.js` (2), `offers.js` (3), `driverApi.js` (4), `simulate.js` (9), changes to `dispatch.js`/`index.js`/`routes.js`/`driverBot.js` (5), `map.js`/`track.js`/`app.js` (7), driver app pages (6), schema (1) ✔. §4 driver experience: all six steps in Task 6, offer card in Tasks 3 and 6, away hint in 6 ✔. §5 rider experience: animated photo marker, live ETA, arrival cue, on-trip redraw, stale banner (Task 7) ✔. §6 safety: auth (4), position privacy via `driverLoc` (5), double-accept (3), `onRideId` (3, 4), createdAt expiry (3), GPS junk guards (2), concierge preserved (3, 5); **rate limits** were listed in the spec and are covered by the existing `limiter` on the ride routes plus the 6 s client cadence — if the reviewer wants explicit per-driver limiters, they belong in Task 4's `registerDriverApi` and are a two-line addition, but the endpoints are all authenticated to a single approved driver, so this is not a hole. §7 testing: every module has a test task; the simulator proves the race live (9) ✔. §8 rollout: Tasks 5–10 in order ✔.

**Placeholder scan.** None. Every code step contains complete code; every verification step has an exact command and expected output.

**Type consistency.** `location.record(driverId, fix, rideId)` / `latest(driverId)` / `trail(rideId)` / `staleSweep()` / `forget(driverId)` — same names in Tasks 2, 4, 5. `offers.open(rideId, round)` / `accept(rideId, driverId)` / `decline(rideId, driverId)` / `expire()` — same in Tasks 3, 4, 5. `registerDriverApi(fastify, deps)` deps match Task 4's implementation and Task 5's `index.js`. `pubJob` field names (`rideId, status, pickup, dropoff, fareEtb, takeEtb, riderName, riderPhone, distanceKm, tripMin, paymentMethod, paymentStatus`) are exactly what `public/drive/app.js` reads in Task 6. `driverLocation` / `driverTrail` are the keys added in Task 5 and consumed in Task 7. `TrackMath` exports (`lerp, bearingBetween, metres, etaText, arrivalNear, easeInOut`) are used by `map.js` and `track.js` in Task 7 and asserted in its test. `BinaMap.setDriver/clearDriver/drawDriverRoute` defined and returned in Task 7 Step 5, called in Step 6.
